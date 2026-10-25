import { describe, expect, it, vi } from "vitest";
import { createPlaybackActivity, type PlaybackSnapshot } from "../src/features/playback/activity";
import type { StreamPlayerEvent } from "../src/features/playback/stream-player";

const tracking = { sessionKey: "test-session", accountId: "owner", versionId: "version" };
function fixture(response?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  let wall = 1_000_000;
  const fetcher = vi.fn(
    response ??
      (async (_input: RequestInfo | URL, init?: RequestInit) =>
        Response.json({ ...JSON.parse(String(init?.body)), credited: false })),
  );
  const activity = createPlaybackActivity({
    videoId: "video",
    durationSeconds: 90,
    expiresAt: wall + 150_000,
    tracking,
    fetcher,
    now: () => wall,
  });
  function sample(
    media: number,
    seconds = 1,
    event: StreamPlayerEvent | "visibility" = "timeupdate",
    values: Partial<PlaybackSnapshot> = {},
  ) {
    wall += seconds * 1000;
    activity.sample(
      { currentTime: media, paused: false, ended: false, visible: true, ...values },
      event,
    );
  }
  const tick = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { activity, fetcher, sample, tick };
}

describe("observed playback activity", () => {
  it.each([737, 930, 1200])(
    "tracks a complete %s-second movie without the old180-second cutoff",
    async (durationSeconds) => {
      let wall = 1_000_000;
      const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
        Response.json({
          watchedSeconds: JSON.parse(String(init?.body)).watchedSeconds,
          credited: true,
        }),
      );
      const activity = createPlaybackActivity({
        videoId: "movie",
        durationSeconds,
        expiresAt: wall + (durationSeconds + 60) * 1000,
        tracking,
        fetcher,
        now: () => wall,
      });
      activity.sample({ currentTime: 0, paused: false, ended: false, visible: true }, "playing");
      for (let second = 1; second <= durationSeconds; second++) {
        wall += 1000;
        activity.sample(
          { currentTime: second, paused: false, ended: false, visible: true },
          "timeupdate",
        );
      }
      expect(activity.watchedSeconds).toBe(durationSeconds);
      await activity.flush();
      expect(JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body)).watchedSeconds).toBe(
        durationSeconds,
      );
      activity.sample({ currentTime: 0, paused: false, ended: false, visible: true }, "seeking");
      wall += 1000;
      activity.sample(
        { currentTime: durationSeconds, paused: false, ended: false, visible: true },
        "seeked",
      );
      expect(activity.watchedSeconds).toBe(durationSeconds);
      activity.invalidate();
    },
  );
  it("counts only actual playing advances, not request/play intent, buffering or hidden time", async () => {
    const f = fixture();
    f.sample(0, 0, "play");
    f.sample(5, 5);
    expect(f.activity.watchedSeconds).toBe(0);
    f.sample(5, 0, "playing");
    f.sample(7, 2);
    f.sample(7, 0, "waiting");
    f.sample(10, 3);
    f.sample(10, 0, "playing");
    f.sample(11);
    f.sample(12, 1, "visibility", { visible: false });
    f.sample(20, 8, "timeupdate", { visible: false });
    f.sample(20, 0, "visibility");
    f.sample(21);
    expect(f.activity.watchedSeconds).toBe(3);
    await f.activity.flush();
    expect(JSON.parse(String(f.fetcher.mock.calls[0][1]?.body)).watchedSeconds).toBe(3);
  });

  it("rejects seek jumps and deduplicates replayed ranges", async () => {
    const f = fixture();
    f.sample(0, 0, "playing");
    for (let second = 1; second <= 10; second++) f.sample(second);
    f.sample(60, 1); // A missing seeking event cannot grant skipped media.
    expect(f.activity.watchedSeconds).toBe(10);
    f.sample(0, 0, "seeking");
    f.sample(0, 0, "seeked");
    f.sample(0, 0, "playing");
    for (let second = 1; second <= 10; second++) f.sample(second);
    expect(f.activity.watchedSeconds).toBe(10);
    f.sample(11);
    expect(f.activity.watchedSeconds).toBe(11);
    await f.activity.stop();
  });

  it("caps fast progression to wall time and drops long timer gaps and invalid media", () => {
    const f = fixture();
    f.sample(0, 0, "playing");
    f.sample(1.25, 1); // small SDK jitter is capped, not granted at playback speed.
    expect(f.activity.watchedSeconds).toBe(1);
    f.sample(3.25, 1); // 2x is an implausible interval.
    f.sample(20, 20);
    f.sample(Number.NaN);
    f.sample(90, 1);
    expect(f.activity.watchedSeconds).toBe(1);
    f.activity.invalidate();
  });

  it("credits integer SDK time without losing fractional timer samples", () => {
    const f = fixture();
    f.sample(0, 0, "playing");
    for (let second = 1; second <= 4; second++) {
      for (let tick = 0; tick < 3; tick++) f.sample(second - 1, 0.25);
      f.sample(second, 0.25);
    }
    expect(f.activity.watchedSeconds).toBe(4);
    f.activity.invalidate();
  });

  it("batches cumulative progress and serializes a final flush behind an in-flight request", async () => {
    let resolveFirst!: (value: Response) => void;
    const f = fixture(async (_input, init) => {
      const { watchedSeconds } = JSON.parse(String(init?.body));
      if (watchedSeconds === 10)
        return new Promise<Response>((resolve) => (resolveFirst = resolve));
      return Response.json({ watchedSeconds, credited: false });
    });
    f.sample(0, 0, "playing");
    for (let second = 1; second <= 10; second++) f.sample(second);
    await f.tick();
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    for (let second = 11; second <= 16; second++) f.sample(second);
    const stopped = f.activity.stop();
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    resolveFirst(Response.json({ watchedSeconds: 10, credited: false }));
    await stopped;
    expect(
      f.fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).watchedSeconds),
    ).toEqual([10, 16]);
    const [path, init] = f.fetcher.mock.calls[0];
    expect(path).toBe("/api/playback/video/progress");
    expect(init?.headers).toMatchObject({ "X-AIVerse-Account": "owner" });
    expect(JSON.parse(String(init?.body))).toEqual({
      sessionKey: "test-session",
      watchedSeconds: 10,
    });
    f.sample(17);
    await f.activity.flush();
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([400, 401, 403, 404, 409, 410])(
    "stops writing after terminal status %s",
    async (status) => {
      const f = fixture(async () => new Response(null, { status }));
      f.sample(0, 0, "playing");
      f.sample(3, 3, "pause", { paused: true });
      await f.activity.flush();
      f.sample(3, 0, "playing");
      f.sample(8, 5);
      await f.activity.flush();
      expect(f.fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it("aborts a stale account request and ignores its late successful reply", async () => {
    let resolve!: (value: Response) => void;
    const f = fixture(() => new Promise<Response>((done) => (resolve = done)));
    f.sample(0, 0, "playing");
    f.sample(4, 4);
    const flush = f.activity.flush();
    await f.tick();
    const signal = f.fetcher.mock.calls[0][1]?.signal;
    f.activity.invalidate();
    expect(signal?.aborted).toBe(true);
    resolve(Response.json({ watchedSeconds: 4, credited: false }));
    await flush;
    f.sample(5);
    await f.activity.flush();
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });

  it("backs off transient failures and bounds repeated rate limits without a retry timer", async () => {
    const f = fixture(
      async () => new Response(null, { status: 429, headers: { "Retry-After": "10" } }),
    );
    f.sample(0, 0, "playing");
    f.sample(2, 2);
    await f.activity.flush();
    await f.activity.flush();
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    f.sample(3, 10);
    await f.activity.flush();
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    f.sample(4, 10);
    await f.activity.flush();
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });

  it("retries an uncertain request idempotently only after cooldown", async () => {
    let attempts = 0;
    const f = fixture(async (_input, init) => {
      if (attempts++ === 0) throw new Error("connection lost after request");
      return Response.json({
        watchedSeconds: JSON.parse(String(init?.body)).watchedSeconds,
        credited: false,
      });
    });
    f.sample(0, 0, "playing");
    f.sample(4, 4);
    await f.activity.flush();
    await f.activity.flush();
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    f.sample(4, 10, "pause", { paused: true });
    await f.activity.flush();
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    expect(f.fetcher.mock.calls[0][1]?.body).toBe(f.fetcher.mock.calls[1][1]?.body);
  });

  it("flushes a final ended interval but never exceeds trusted duration", async () => {
    const f = fixture();
    f.sample(0, 0, "playing");
    for (let second = 1; second < 90; second++) f.sample(second);
    f.sample(90, 1, "ended", { paused: true, ended: true });
    await f.activity.flush();
    expect(f.activity.watchedSeconds).toBe(90);
    expect(JSON.parse(String(f.fetcher.mock.calls.at(-1)?.[1]?.body)).watchedSeconds).toBe(90);
    f.activity.invalidate();
  });

  it("does not track expired or invalid grants", async () => {
    const fetcher = vi.fn();
    for (const durationSeconds of [0, 1201, Number.NaN, 1.5]) {
      const activity = createPlaybackActivity({
        videoId: "video",
        durationSeconds,
        expiresAt: 1000,
        tracking,
        now: () => 1,
        fetcher,
      });
      activity.sample({ currentTime: 0, paused: false, ended: false, visible: true }, "playing");
      await activity.flush();
    }
    const f = fixture();
    f.sample(0, 0, "playing");
    f.sample(1, 151);
    await f.activity.flush();
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
