/** Cloudflare's documented iframe SDK; loaded only after a valid playback grant. */
export const streamSDKSource = "https://embed.cloudflarestream.com/embed/sdk.latest.js";

export const streamPlayerEvents = [
  "play",
  "playing",
  "pause",
  "timeupdate",
  "seeking",
  "seeked",
  "waiting",
  "stalled",
  "ended",
  "error",
  "abort",
] as const;
export type StreamPlayerEvent = (typeof streamPlayerEvents)[number];
export type StreamPlayer = {
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly ended: boolean;
  muted: boolean;
  volume: number;
  play(): Promise<void>;
  pause(): void;
  addEventListener(event: StreamPlayerEvent, listener: () => void): void;
  removeEventListener(event: StreamPlayerEvent, listener: () => void): void;
};
export type StreamPlayerFactory = (iframe: HTMLIFrameElement) => StreamPlayer;

declare global {
  interface Window {
    Stream?: StreamPlayerFactory;
  }
}

let loading: Promise<StreamPlayerFactory> | null = null;

function sharedSDK() {
  if (typeof window === "undefined" || typeof document === "undefined")
    return Promise.reject(new Error("Video controls require a browser."));
  if (window.Stream) return Promise.resolve(window.Stream);
  if (loading) return loading;
  const script = document.createElement("script");
  script.src = streamSDKSource;
  script.async = true;
  script.referrerPolicy = "no-referrer";
  const request = new Promise<StreamPlayerFactory>((resolve, reject) => {
    const timer = setTimeout(
      () => finish(new Error("Video controls took too long to load.")),
      10_000,
    );
    function finish(error?: Error) {
      clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      if (error || !window.Stream) {
        script.remove();
        reject(error ?? new Error("Video controls are unavailable."));
      } else resolve(window.Stream);
    }
    script.onload = () => finish();
    script.onerror = () => finish(new Error("Video controls could not load."));
    try {
      document.head.appendChild(script);
    } catch {
      finish(new Error("Video controls could not load."));
    }
  });
  loading = request.catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

/** Aborting one consumer does not cancel the shared script for another player. */
export function loadStreamPlayerSDK({ signal }: { signal?: AbortSignal } = {}) {
  if (signal?.aborted) return Promise.reject(new DOMException("Cancelled", "AbortError"));
  const request = sharedSDK();
  if (!signal) return request;
  return new Promise<StreamPlayerFactory>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(new DOMException("Cancelled", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    request.then(
      (factory) => {
        signal.removeEventListener("abort", abort);
        if (!signal.aborted) resolve(factory);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

/** Detach SDK observers and pause; caller then removes its iframe. */
export function observeStreamPlayer(
  player: StreamPlayer,
  listener: (event: StreamPlayerEvent) => void,
) {
  const handlers = streamPlayerEvents.map((event) => {
    const handler = () => listener(event);
    player.addEventListener(event, handler);
    return { event, handler };
  });
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    for (const { event, handler } of handlers) player.removeEventListener(event, handler);
    // The iframe SDK has no documented destroy method. Removing our observers,
    // pausing, and removing the owning iframe are its lifecycle boundary.
    try {
      player.pause();
    } catch {
      // Best effort when the frame has already navigated or been removed.
    }
  };
}
