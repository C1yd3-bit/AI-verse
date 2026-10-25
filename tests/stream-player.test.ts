import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
});

function browser() {
  const scripts: {
    src: string;
    onload: (() => void) | null;
    onerror: (() => void) | null;
    remove: ReturnType<typeof vi.fn>;
  }[] = [];
  const window = {} as Window;
  const document = {
    createElement: vi.fn(() => ({ src: "", onload: null, onerror: null, remove: vi.fn() })),
    head: { appendChild: vi.fn((script) => scripts.push(script)) },
  };
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  return { window, document, scripts };
}

describe("Stream iframe SDK lifecycle", () => {
  it("shares one lazy load and cancellation affects only that consumer", async () => {
    const b = browser();
    const sdk = await import("../src/features/playback/stream-player");
    expect(b.scripts).toHaveLength(0);
    const controller = new AbortController();
    const cancelled = sdk.loadStreamPlayerSDK({ signal: controller.signal });
    const cancelledAssertion = expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    const other = sdk.loadStreamPlayerSDK();
    expect(b.scripts).toHaveLength(1);
    expect(b.scripts[0].src).toBe("https://embed.cloudflarestream.com/embed/sdk.latest.js");
    controller.abort();
    await cancelledAssertion;
    const factory = vi.fn();
    b.window.Stream = factory;
    b.scripts[0].onload?.();
    expect(await other).toBe(factory);
    expect(await sdk.loadStreamPlayerSDK()).toBe(factory);
    expect(b.scripts).toHaveLength(1);
    expect(b.scripts[0].onload).toBeNull();
    expect(b.scripts[0].onerror).toBeNull();
  });

  it("does not load a script for an already cancelled consumer", async () => {
    const b = browser();
    const sdk = await import("../src/features/playback/stream-player");
    const controller = new AbortController();
    controller.abort();
    await expect(sdk.loadStreamPlayerSDK({ signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(b.scripts).toHaveLength(0);
  });

  it("cleans a failed load and allows one fresh retry", async () => {
    const b = browser();
    const sdk = await import("../src/features/playback/stream-player");
    const failed = sdk.loadStreamPlayerSDK();
    const assertion = expect(failed).rejects.toThrow("could not load");
    b.scripts[0].onerror?.();
    await assertion;
    expect(b.scripts[0].remove).toHaveBeenCalledOnce();
    const retried = sdk.loadStreamPlayerSDK();
    expect(b.scripts).toHaveLength(2);
    b.window.Stream = vi.fn();
    b.scripts[1].onload?.();
    expect(await retried).toBe(b.window.Stream);
  });

  it("times out a stalled script and removes its callbacks", async () => {
    vi.useFakeTimers();
    const b = browser();
    const sdk = await import("../src/features/playback/stream-player");
    const stalled = sdk.loadStreamPlayerSDK();
    const assertion = expect(stalled).rejects.toThrow("too long");
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    expect(b.scripts[0].remove).toHaveBeenCalledOnce();
    expect(b.scripts[0].onload).toBeNull();
    expect(b.scripts[0].onerror).toBeNull();
  });

  it("rejects a loaded script missing the expected factory", async () => {
    const b = browser();
    const sdk = await import("../src/features/playback/stream-player");
    const loaded = sdk.loadStreamPlayerSDK();
    const assertion = expect(loaded).rejects.toThrow("unavailable");
    b.scripts[0].onload?.();
    await assertion;
    expect(b.scripts[0].remove).toHaveBeenCalledOnce();
  });

  it("removes the exact listeners and pauses once without inventing a destroy API", async () => {
    const sdk = await import("../src/features/playback/stream-player");
    const handlers = new Map<string, () => void>();
    const player = {
      currentTime: 0,
      duration: 90,
      paused: false,
      ended: false,
      muted: false,
      volume: 1,
      play: vi.fn(async () => {}),
      pause: vi.fn(),
      addEventListener: vi.fn((event: string, listener: () => void) =>
        handlers.set(event, listener),
      ),
      removeEventListener: vi.fn((event: string, listener: () => void) => {
        expect(handlers.get(event)).toBe(listener);
        handlers.delete(event);
      }),
    };
    const listener = vi.fn();
    const dispose = sdk.observeStreamPlayer(player, listener);
    handlers.get("playing")?.();
    expect(listener).toHaveBeenCalledWith("playing");
    dispose();
    dispose();
    expect(handlers.size).toBe(0);
    expect(player.pause).toHaveBeenCalledOnce();
    expect(player.removeEventListener).toHaveBeenCalledTimes(sdk.streamPlayerEvents.length);
  });
});
