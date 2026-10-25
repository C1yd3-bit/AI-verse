import type { StreamPlayerEvent } from "./stream-player";
import { MAX_MOVIE_SECONDS } from "@/features/media/policy";

export type PlaybackTracking = {
  sessionKey: string;
  accountId: string;
  versionId: string;
};

export type PlaybackSnapshot = {
  currentTime: number;
  paused: boolean;
  ended: boolean;
  visible: boolean;
};

type Options = {
  videoId: string;
  durationSeconds: number;
  /** Absolute grant expiry in milliseconds. Never extend it after SDK loading. */
  expiresAt: number;
  tracking: PlaybackTracking;
  fetcher?: typeof fetch;
  now?: () => number;
};

type Range = [number, number];
const reportStep = 10;
const failureCooldown = 10_000;

/** Unique observed media ranges, not proof of attention or a public view count. */
export function createPlaybackActivity(options: Options) {
  const now = options.now ?? Date.now;
  const fetcher = options.fetcher ?? fetch;
  const duration = options.durationSeconds;
  let valid =
    Number.isInteger(duration) &&
    duration >= 1 &&
    duration <= MAX_MOVIE_SECONDS &&
    Number.isFinite(options.expiresAt) &&
    options.expiresAt > now() &&
    Boolean(
      options.tracking.sessionKey && options.tracking.accountId && options.tracking.versionId,
    );
  let stopped = false;
  let playing = false;
  let previous: { media: number; wall: number } | null = null;
  let ranges: Range[] = [];
  let observed = 0;
  let acknowledged = 0;
  let forced = false;
  let running: Promise<void> | null = null;
  let controller: AbortController | null = null;
  let retryAt = 0;
  let rateLimits = 0;

  function eligible() {
    if (now() >= options.expiresAt) invalidate();
    return valid;
  }

  function invalidate() {
    valid = false;
    stopped = true;
    playing = false;
    previous = null;
    forced = false;
    controller?.abort();
  }

  function addRange(start: number, end: number) {
    // Natural playback merges into a handful of ranges. Bound pathological
    // repeated seek fragmentation without granting its omitted intervals.
    if (ranges.length >= 1024) return;
    const merged: Range[] = [];
    for (const range of [...ranges, [start, end] as Range].sort((a, b) => a[0] - b[0])) {
      const tail = merged.at(-1);
      if (tail && range[0] <= tail[1]) tail[1] = Math.max(tail[1], range[1]);
      else merged.push([...range]);
    }
    ranges = merged;
    observed = Math.min(
      duration,
      Math.floor(ranges.reduce((sum, [a, b]) => sum + b - a, 0) + 1e-6),
    );
  }

  async function drain() {
    while (eligible() && observed > acknowledged && now() >= retryAt) {
      if (!forced && observed - acknowledged < reportStep) break;
      const sent = observed;
      forced = false;
      controller = new AbortController();
      const requestController = controller;
      const timeout = setTimeout(() => requestController.abort(), 5000);
      try {
        const response = await fetcher(
          `/api/playback/${encodeURIComponent(options.videoId)}/progress`,
          {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            keepalive: true,
            signal: requestController.signal,
            headers: {
              "Content-Type": "application/json",
              "X-AIVerse-Account": options.tracking.accountId,
            },
            body: JSON.stringify({ sessionKey: options.tracking.sessionKey, watchedSeconds: sent }),
          },
        );
        if (!valid || requestController.signal.aborted) break;
        if ([400, 401, 403, 404, 409, 410].includes(response.status)) {
          invalidate();
          break;
        }
        if (response.status === 429) {
          rateLimits += 1;
          if (rateLimits >= 2) invalidate();
          else {
            const seconds = Number(response.headers.get("Retry-After"));
            retryAt =
              now() + Math.max(10, Math.min(60, Number.isFinite(seconds) ? seconds : 10)) * 1000;
          }
          break;
        }
        if (!response.ok) {
          retryAt = now() + failureCooldown;
          break;
        }
        const result: unknown = await response.json();
        if (!valid || requestController.signal.aborted) break;
        if (
          !result ||
          typeof result !== "object" ||
          !("watchedSeconds" in result) ||
          !Number.isInteger(result.watchedSeconds) ||
          (result.watchedSeconds as number) < sent ||
          (result.watchedSeconds as number) > duration ||
          !("credited" in result) ||
          typeof result.credited !== "boolean"
        ) {
          invalidate();
          break;
        }
        acknowledged = result.watchedSeconds as number;
        retryAt = 0;
      } catch {
        if (valid) retryAt = now() + failureCooldown;
        break;
      } finally {
        clearTimeout(timeout);
        if (controller === requestController) controller = null;
      }
    }
  }

  function pump() {
    if (!running) {
      running = Promise.resolve()
        .then(drain)
        .finally(() => {
          running = null;
          if (needsReport()) void pump();
        });
    }
    return running;
  }

  function needsReport() {
    return (
      valid &&
      now() < options.expiresAt &&
      now() >= retryAt &&
      observed > acknowledged &&
      (forced || observed - acknowledged >= reportStep)
    );
  }

  async function flush() {
    if (!eligible()) return Promise.resolve();
    forced = true;
    // A flush arriving in the worker's final microtask must still wait for its
    // own final cumulative write, rather than returning behind the old worker.
    do {
      await pump();
    } while (needsReport());
  }

  function sample(snapshot: PlaybackSnapshot, event: StreamPlayerEvent | "visibility") {
    if (stopped || !eligible()) return;
    const wall = now();
    const media = snapshot.currentTime;
    const usable = Number.isFinite(media) && media >= 0 && media <= duration + 0.5;
    const interruption = ["seeking", "seeked", "waiting", "stalled", "error", "abort"].includes(
      event,
    );
    if (!usable || !snapshot.visible || interruption || event === "visibility") {
      playing = false;
      previous = null;
      if (event === "visibility" || event === "error" || event === "abort") void flush();
      return;
    }
    if (playing && previous) {
      const elapsed = (wall - previous.wall) / 1000;
      const delta = media - previous.media;
      // Reject seeking/jumps and long sampling gaps. Cap credit to actual elapsed
      // wall time; sped-up media, repeated loops and integer rounding earn no extra.
      if (elapsed > 0 && elapsed <= 5 && delta > 0 && delta <= elapsed + 0.5) {
        addRange(previous.media, Math.min(duration, previous.media + Math.min(delta, elapsed)));
      }
    }
    if (event === "playing" && !snapshot.paused && !snapshot.ended) {
      playing = true;
      previous = { media: Math.min(media, duration), wall };
    } else if (
      snapshot.paused ||
      snapshot.ended ||
      event === "pause" ||
      event === "ended" ||
      event === "play"
    ) {
      playing = false;
      previous = null;
    } else if (playing && (!previous || media !== previous.media)) {
      previous = { media: Math.min(media, duration), wall };
    }
    if (event === "pause" || event === "ended") void flush();
    else if (observed - acknowledged >= reportStep) void pump();
  }

  return {
    sample,
    flush,
    invalidate,
    get watchedSeconds() {
      return observed;
    },
    async stop({ flush: finalFlush = true }: { flush?: boolean } = {}) {
      stopped = true;
      playing = false;
      previous = null;
      if (finalFlush) await flush();
      invalidate();
    },
  };
}
