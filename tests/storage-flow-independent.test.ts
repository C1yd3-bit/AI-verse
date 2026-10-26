import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMediaStorageHandler } from "../supabase/functions/media-storage/core";
import { inspectMp4 } from "../supabase/functions/media-storage/mp4";

const ids = {
  owner: "a8000000-0000-4000-8000-000000000001",
  version: "a8000000-0000-4000-8000-000000000002",
  reservation: "a8000000-0000-4000-8000-000000000003",
  video: "a8000000-0000-4000-8000-000000000004",
  other: "a8000000-0000-4000-8000-000000000005",
};
const origin = "https://fixture-project.supabase.co";
const bucket = "aiverse-videos";
const object = `${ids.owner}/${ids.version}/${ids.reservation}.mp4`;
const publicKey = "fixture-public-key";
const serviceKey = "fixture-service-key";
const clock = Date.parse("2026-10-26T00:00:00Z");
const signedFixture = (expiresAt: number) =>
  `fixture.${Buffer.from(JSON.stringify({ exp: expiresAt })).toString("base64url")}.signature`;
const concat = (...parts: Uint8Array[]) => {
  const output = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
};
const integers = (...values: number[]) => {
  const output = new Uint8Array(values.length * 4);
  const view = new DataView(output.buffer);
  values.forEach((value, offset) => view.setUint32(offset * 4, value));
  return output;
};
const ascii = (value: string) => new TextEncoder().encode(value);
const box = (name: string, ...parts: Uint8Array[]) => {
  const body = concat(...parts);
  return concat(integers(body.length + 8), ascii(name), body);
};
/** Structural MP4 fixture only; actual decoder/transfer tests use a separate local real file. */
function mp4(sampleOffset?: number) {
  const ftyp = box("ftyp", ascii("isom"), integers(0), ascii("isom"));
  const mdat = box("mdat", new Uint8Array(32));
  const start = ftyp.length + 8;
  const duration = integers(0, 0, 0, 1000, 1000);
  const avcc = box("avcC", new Uint8Array([1, 100, 0, 31, 255, 225, 0]));
  const description = box("avc1", new Uint8Array(78), avcc);
  const stbl = box(
    "stbl",
    box("stsd", integers(0, 1), description),
    box("stts", integers(0, 1, 1, 1000)),
    box("stsc", integers(0, 1, 1, 1, 1)),
    box("stsz", integers(0, 0, 1, 32)),
    box("stco", integers(0, 1, sampleOffset ?? start)),
  );
  const dinf = box("dinf", box("dref", integers(0, 1), box("url ", integers(1))));
  const mdia = box(
    "mdia",
    box("mdhd", duration),
    box("hdlr", integers(0, 0), ascii("vide")),
    box("minf", dinf, stbl),
  );
  return concat(ftyp, mdat, box("moov", box("mvhd", duration), box("trak", mdia)));
}

function edgeHarness() {
  let time = clock;
  const bytes = mp4();
  const upload = {
    reservation_id: ids.reservation,
    version_id: ids.version,
    owner_id: ids.owner,
    bucket,
    object_path: object,
    expected_bytes: bytes.length,
    state: "reserved",
  };
  const entitlement = {
    bucket,
    object_path: object,
    version_id: ids.version,
    duration_seconds: 1,
    expires_at: new Date(clock + 61000).toISOString(),
    public_playback: true,
  };
  const getUser = vi.fn(async () => ({
    data: { user: { id: ids.owner, email_confirmed_at: "2026-10-25T00:00:00Z" } },
    error: null as unknown,
  }));
  const lookup = vi.fn(async () => ({ data: upload, error: null }));
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) chain[method] = vi.fn(() => chain);
  chain.maybeSingle = lookup;
  const rpc = vi.fn(async () => ({ data: { ...entitlement }, error: null }));
  const complete = vi.fn(async (name: string, body: unknown) => {
    void name;
    void body;
    return {
      data: { version_id: ids.version, state: "pending_review" },
      error: null,
    };
  });
  const sign = vi.fn(async () => ({
    data: {
      signedUrl: `${origin}/storage/v1/object/sign/${bucket}/${object}?token=${signedFixture(clock / 1000 + 56)}`,
    },
    error: null,
  }));
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void input;
    void init;
    return new Response(bytes, { headers: { "content-length": String(bytes.length) } });
  });
  const caller = { auth: { getUser }, from: vi.fn(() => chain), rpc };
  const admin = {
    rpc: vi.fn((name: string, body: unknown) =>
      name === "complete_storage_video_upload"
        ? complete(name, body)
        : Promise.resolve({ data: [], error: null }),
    ),
    storage: { from: vi.fn(() => ({ createSignedUrl: sign })) },
  };
  const createClient = vi.fn((key: string) => (key === serviceKey ? admin : caller));
  const handler = createMediaStorageHandler({
    url: origin,
    anonKey: publicKey,
    serviceKey,
    createClient: createClient as unknown as Parameters<
      typeof createMediaStorageHandler
    >[0]["createClient"],
    fetcher: fetcher as unknown as typeof fetch,
    now: () => time,
  });
  const request = (
    action: "complete" | "playback",
    authorization: string | null = "Bearer fixture-user",
    extra = {},
  ) =>
    handler(
      new Request("https://edge.test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authorization === null ? {} : { Authorization: authorization }),
        },
        body: JSON.stringify(
          action === "complete"
            ? { action, reservationId: ids.reservation, versionId: ids.version, ...extra }
            : { action, videoId: ids.video, ...extra },
        ),
      }),
    );
  return {
    bytes,
    upload,
    entitlement,
    getUser,
    lookup,
    rpc,
    complete,
    sign,
    fetcher,
    createClient,
    request,
    advance: (milliseconds: number) => {
      time += milliseconds;
    },
  };
}

describe("independent Storage byte and Edge authorization contracts", () => {
  it("inspects the bounded structural baseline", () => {
    expect(inspectMp4(mp4())).toMatchObject({ durationSeconds: 1, codec: "h264" });
  });
  it.each([0, 27, 999999])("rejects sample chunks outside uploaded mdat at %s", (offset) => {
    expect(() => inspectMp4(mp4(offset))).toThrow();
  });
  it("never completes a private upload for an anonymous request", async () => {
    const h = edgeHarness();
    expect((await h.request("complete", null)).status).toBe(401);
    expect(h.lookup).not.toHaveBeenCalled();
    expect(h.fetcher).not.toHaveBeenCalled();
    expect(h.complete).not.toHaveBeenCalled();
  });
  it("never downgrades an invalid JWT to public playback", async () => {
    const h = edgeHarness();
    h.getUser.mockResolvedValueOnce({
      data: { user: null as never },
      error: new Error("invalid fixture token"),
    });
    expect((await h.request("playback")).status).toBe(401);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.sign).not.toHaveBeenCalled();
  });
  it.each(["Basic fixture", "Bearer", "Bearer fixture extra"])(
    "rejects malformed supplied authorization: %s",
    async (authorization) => {
      const h = edgeHarness();
      expect((await h.request("playback", authorization)).status).toBe(401);
      expect(h.rpc).not.toHaveBeenCalled();
      expect(h.sign).not.toHaveBeenCalled();
    },
  );
  it("permits intentional anonymous published playback without creating activity", async () => {
    const h = edgeHarness();
    const response = await h.request("playback", null);
    expect(response.status).toBe(200);
    expect(h.getUser).not.toHaveBeenCalled();
    expect((await response.json()).tracking).toBeNull();
  });
  it("blocks private object-path substitutions before any privileged download", async () => {
    const h = edgeHarness();
    h.upload.object_path = `${ids.other}/${ids.version}/${ids.reservation}.mp4`;
    expect((await h.request("complete")).status).toBe(404);
    expect(h.fetcher).not.toHaveBeenCalled();
    expect(h.complete).not.toHaveBeenCalled();
  });
  it("requires full exact-size bytes before service-only completion", async () => {
    const h = edgeHarness();
    h.fetcher.mockResolvedValueOnce(new Response(h.bytes.subarray(0, h.bytes.length - 1)));
    expect((await h.request("complete")).status).toBe(422);
    expect(h.complete).not.toHaveBeenCalled();
  });
  it("rejects streamed bytes beyond the sealed reservation before completion", async () => {
    const h = edgeHarness();
    h.fetcher.mockResolvedValueOnce(new Response(concat(h.bytes, new Uint8Array([0]))));
    expect((await h.request("complete")).status).toBe(422);
    expect(h.complete).not.toHaveBeenCalled();
  });
  it("completes only after the service reads and inspects exact sealed bytes", async () => {
    const h = edgeHarness();
    const response = await h.request("complete");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      accountId: ids.owner,
      versionId: ids.version,
      reservationId: ids.reservation,
      status: "pending_review",
    });
    expect(h.fetcher.mock.calls[0][0].toString()).toBe(
      `${origin}/storage/v1/object/authenticated/${bucket}/${object}`,
    );
    expect(h.complete).toHaveBeenCalledOnce();
    expect(h.complete).toHaveBeenCalledWith("complete_storage_video_upload", {
      reservation_id: ids.reservation,
      actual_bytes: h.bytes.length,
      duration_seconds: 1,
    });
    expect(h.complete.mock.invocationCallOrder[0]).toBeGreaterThan(
      h.fetcher.mock.invocationCallOrder[0],
    );
  });
  it("does not let a late final SQL denial become an accepted upload", async () => {
    const h = edgeHarness();
    h.complete.mockResolvedValueOnce({ data: null as never, error: { code: "42501" } as never });
    expect((await h.request("complete")).status).toBe(409);
    expect(h.complete).toHaveBeenCalledWith("complete_storage_video_upload", {
      reservation_id: ids.reservation,
      actual_bytes: h.bytes.length,
      duration_seconds: 1,
    });
  });
  it("never returns a signed grant after entitlement was removed", async () => {
    const h = edgeHarness();
    h.rpc
      .mockResolvedValueOnce({ data: h.entitlement, error: null })
      .mockResolvedValueOnce({ data: null as never, error: null });
    expect((await h.request("playback", null)).status).toBe(404);
  });
  it("does not extend the original entitlement deadline through signing latency", async () => {
    const h = edgeHarness();
    h.sign.mockImplementationOnce(async () => {
      h.advance(6000);
      h.entitlement.expires_at = new Date(clock + 67000).toISOString();
      return {
        data: {
          signedUrl: `${origin}/storage/v1/object/sign/${bucket}/${object}?token=${signedFixture(clock / 1000 + 62)}`,
        },
        error: null,
      };
    });
    const response = await h.request("playback", null);
    if (response.status === 200)
      expect((await response.json()).expiresAt).toBeLessThanOrEqual((clock + 61000) / 1000);
    else expect([404, 409, 503]).toContain(response.status);
  });
  it("rejects an unreadable signed capability rather than inventing its expiration", async () => {
    const h = edgeHarness();
    h.sign.mockResolvedValueOnce({
      data: { signedUrl: `${origin}/storage/v1/object/sign/${bucket}/${object}?token=malformed` },
      error: null,
    });
    expect((await h.request("playback", null)).status).toBe(503);
  });
});

const mocks = vi.hoisted(() => ({
  server: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
  invoke: vi.fn(),
  sign: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  getSupabaseConfig: () => ({
    url: "https://fixture-project.supabase.co",
    key: "fixture-public-key",
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.server }));
import { POST as reserve } from "../src/app/api/studio/uploads/route";
import { POST as finish } from "../src/app/api/studio/uploads/complete/route";
import { GET as playback } from "../src/app/api/playback/[id]/route";
function routeRequest(
  path: string,
  body?: unknown,
  account: string = ids.owner,
  requestOrigin = "http://localhost:3000",
) {
  return new Request(`http://localhost:3000${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: requestOrigin,
      "Content-Type": "application/json",
      "X-AIVerse-Account": account,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const reserveInput = () => ({
  versionId: ids.version,
  idempotencyKey: "independent-fixture-key",
  fileSize: 100,
});
const finishInput = () => ({ versionId: ids.version, reservationId: ids.reservation });
const routeGrant = () => ({
  videoUrl: `${origin}/storage/v1/object/sign/${bucket}/${object}?token=fixture`,
  expiresAt: Math.floor(Date.now() / 1000) + 60,
  durationSeconds: 1,
  versionId: ids.version,
  tracking: null,
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({
    data: { user: { id: ids.owner, email_confirmed_at: "2026-10-25T00:00:00Z" } },
    error: null,
  });
  mocks.rpc.mockResolvedValue({
    data: {
      reservation_id: ids.reservation,
      version_id: ids.version,
      bucket,
      object_path: object,
      expires_at: new Date(Date.now() + 900000).toISOString(),
      max_duration_seconds: 180,
      file_size: 100,
    },
    error: null,
  });
  mocks.sign.mockResolvedValue({
    data: {
      signedUrl: `${origin}/storage/v1/object/upload/sign/${bucket}/${object}?token=fixture`,
    },
    error: null,
  });
  mocks.invoke.mockResolvedValue({
    data: {
      accountId: ids.owner,
      versionId: ids.version,
      reservationId: ids.reservation,
      status: "pending_review",
    },
    error: null,
  });
  mocks.server.mockResolvedValue({
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
    functions: { invoke: mocks.invoke },
    storage: { from: () => ({ createSignedUploadUrl: mocks.sign }) },
  });
});
describe("independent active Next Storage boundaries", () => {
  it("reserves using only the verified caller RPC and a non-overwrite exact path", async () => {
    expect((await reserve(routeRequest("/api/studio/uploads", reserveInput()))).status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith("reserve_storage_video_upload", {
      version_id: ids.version,
      idempotency_key: reserveInput().idempotencyKey,
      file_size: 100,
    });
    expect(mocks.sign).toHaveBeenCalledWith(object, { upsert: false });
  });
  it.each([0, 50_000_001])(
    "rejects out-of-bounds file size %s before reserving",
    async (fileSize) => {
      expect(
        (await reserve(routeRequest("/api/studio/uploads", { ...reserveInput(), fileSize })))
          .status,
      ).toBe(400);
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it.each([reserve, finish])(
    "rejects stale ownership and hostile origins before mutations",
    async (handler) => {
      const body = handler === reserve ? reserveInput() : finishInput();
      expect((await handler(routeRequest("/api/studio/uploads", body, ids.other))).status).toBe(
        409,
      );
      expect(
        (
          await handler(
            routeRequest("/api/studio/uploads", body, ids.owner, "https://hostile.test"),
          )
        ).status,
      ).toBe(403);
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.invoke).not.toHaveBeenCalled();
    },
  );
  it("rejects completion identity substitutions from the Edge response", async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: {
        accountId: ids.other,
        versionId: ids.version,
        reservationId: ids.reservation,
        status: "pending_review",
      },
      error: null,
    });
    expect((await finish(routeRequest("/api/studio/uploads/complete", finishInput()))).status).toBe(
      409,
    );
  });
  it("preserves safe malformed-file failure status without exposing upstream details", async () => {
    mocks.invoke.mockResolvedValueOnce({
      data: null,
      error: { context: new Response("private upstream detail", { status: 422 }) },
    });
    const response = await finish(routeRequest("/api/studio/uploads/complete", finishInput()));
    expect(response.status).toBe(422);
    expect(await response.text()).not.toContain("private upstream");
  });
  it.each([
    "https://hostile.test/video.mp4",
    `${origin}/storage/v1/object/public/${bucket}/${object}`,
    `${origin}/storage/v1/object/sign/${bucket}/${object}?token=fixture#fragment`,
  ])("rejects untrusted playback capability %s", async (videoUrl) => {
    mocks.invoke.mockResolvedValueOnce({ data: { ...routeGrant(), videoUrl }, error: null });
    expect(
      (
        await playback(routeRequest(`/api/playback/${ids.video}`), {
          params: Promise.resolve({ id: ids.video }),
        })
      ).status,
    ).toBe(503);
  });
  it("permits anonymous playback using an explicit anonymous Edge invocation", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    mocks.invoke.mockResolvedValueOnce({ data: routeGrant(), error: null });
    expect(
      (
        await playback(routeRequest(`/api/playback/${ids.video}`), {
          params: Promise.resolve({ id: ids.video }),
        })
      ).status,
    ).toBe(200);
    expect(mocks.invoke).toHaveBeenCalledWith("media-storage", {
      body: { action: "playback", videoId: ids.video, versionId: null },
      headers: { Authorization: "" },
    });
  });
  it("does not turn a rejected existing session into anonymous playback", async () => {
    mocks.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: { name: "AuthApiError", code: "refresh_token_not_found", status: 401 },
    });
    mocks.invoke.mockResolvedValueOnce({ data: routeGrant(), error: null });
    expect(
      (
        await playback(routeRequest(`/api/playback/${ids.video}`), {
          params: Promise.resolve({ id: ids.video }),
        })
      ).status,
    ).toBe(401);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
