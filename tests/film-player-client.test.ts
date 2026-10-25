import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { accountChangedEvent, accountUnavailableEvent } from "../src/lib/appearance";
import type { StreamPlayer, StreamPlayerEvent } from "../src/features/playback/stream-player";

type Effect = { deps: unknown[]; cleanup?: () => void };
const hooks = vi.hoisted(() => ({
  cursor: 0,
  values: [] as unknown[],
  effects: new Map<number, Effect>(),
  pending: [] as (() => void)[],
  ready: true,
  accountId: "94000000-0000-4000-8000-000000000001" as string | null,
  load: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useId: () => "actual-film-player",
  useCallback: (callback: unknown) => callback,
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [
      hooks.values[index],
      (value: unknown) => {
        hooks.values[index] = typeof value === "function" ? value(hooks.values[index]) : value;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = { current: initial };
    return hooks.values[index];
  },
  useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
    const index = hooks.cursor++;
    const previous = hooks.effects.get(index);
    // Callback identity is intentionally ignored by this tiny scheduler; the
    // component's useCallback dependencies are stable primitive instance IDs.
    const normalized = deps.map((value) =>
      typeof value === "function" ? "stable-callback" : value,
    );
    if (previous && normalized.every((value, offset) => Object.is(value, previous.deps[offset])))
      return;
    hooks.pending.push(() => {
      previous?.cleanup?.();
      hooks.effects.set(index, { deps: normalized, cleanup: effect() });
    });
  },
}));
vi.mock("../src/components/appearance-provider", () => ({
  useAppearance: () => ({ ready: hooks.ready, accountId: hooks.accountId }),
}));
vi.mock("../src/features/playback/stream-player", async (original) => ({
  ...(await original<typeof import("../src/features/playback/stream-player")>()),
  loadStreamPlayerSDK: (options: unknown) => hooks.load(options),
}));
import { FilmPlayer } from "../src/components/film-player";

const videoId = "94000000-0000-4000-8000-000000000002";
const versionId = "94000000-0000-4000-8000-000000000003";
const accountId = "94000000-0000-4000-8000-000000000001";
const otherAccount = "94000000-0000-4000-8000-000000000005";
const sessionKey = "94000000-0000-4000-8000-000000000004";
type Props = Parameters<typeof FilmPlayer>[0];
type Node = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
let props: Props;
let nodes: Node[];
let fakeFrame: { src: string } | null;
let fetchMock: ReturnType<typeof vi.fn>;
let player: StreamPlayer & {
  emit: (event: StreamPlayerEvent) => void;
  pause: ReturnType<typeof vi.fn<() => void>>;
};
let documentTarget: EventTarget & { visibilityState: string };

function elements(node: ReactNode): Node[] {
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as Node;
  return [
    element,
    ...[element.props.children].flat(Infinity).flatMap((child) => elements(child as ReactNode)),
  ];
}
function render() {
  hooks.cursor = 0;
  const wrapper = FilmPlayer(props);
  const session = wrapper.type as (value: Props) => ReactElement;
  nodes = elements(session(wrapper.props));
  const frame = nodes.find((node) => node.type === "iframe");
  if (frame) {
    fakeFrame ??= { src: String(frame.props.src) };
    (frame.props.ref as { current: unknown }).current = fakeFrame;
  }
  for (const effect of hooks.pending.splice(0)) effect();
  return nodes;
}
async function settle() {
  for (let index = 0; index < 8; index++) {
    await Promise.resolve();
    render();
  }
}
function click(label: string) {
  const button = render().find(
    (node) =>
      node.type === "button" &&
      elements(node).some((part) =>
        [part.props.children].flat(Infinity).some((child) => child === label),
      ),
  );
  if (!button) throw new Error(`Missing ${label} button`);
  return (button.props.onClick as () => Promise<void> | void)();
}
function grant(overrides: Record<string, unknown> = {}) {
  return {
    iframeUrl: "https://iframe.videodelivery.net/signed-test-token",
    expiresAt: Math.floor(Date.now() / 1000) + 120,
    versionId,
    durationSeconds: 90,
    tracking: { sessionKey, accountId, versionId },
    ...overrides,
  };
}
function progressRequests() {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
}
async function start() {
  await click(props.versionId ? "Open private preview" : "Play film");
  await settle();
}
function playing(seconds = 4) {
  player.currentTime = 0;
  Object.assign(player, { paused: false });
  player.emit("playing");
  vi.advanceTimersByTime(seconds * 1000);
  player.currentTime = seconds;
  player.emit("timeupdate");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-25T00:00:00Z"));
  hooks.cursor = 0;
  hooks.values = [];
  hooks.effects = new Map();
  hooks.pending = [];
  hooks.ready = true;
  hooks.accountId = accountId;
  props = { videoId, title: "Actual component fixture" };
  nodes = [];
  fakeFrame = null;
  const listeners = new Map<StreamPlayerEvent, () => void>();
  player = {
    currentTime: 0,
    duration: 90,
    paused: true,
    ended: false,
    muted: false,
    volume: 1,
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    addEventListener: (event, listener) => {
      listeners.set(event, listener);
    },
    removeEventListener: (event) => {
      listeners.delete(event);
    },
    emit: (event) => {
      listeners.get(event)?.();
    },
  };
  hooks.load.mockReset();
  hooks.load.mockResolvedValue(() => player);
  fetchMock = vi.fn(async (_input, init) =>
    init?.method === "POST"
      ? Response.json({ watchedSeconds: JSON.parse(init.body).watchedSeconds, credited: false })
      : Response.json(grant()),
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", Object.assign(new EventTarget(), { setTimeout, clearTimeout }));
  documentTarget = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("document", documentTarget);
});
afterEach(async () => {
  for (const effect of hooks.effects.values()) effect.cleanup?.();
  await Promise.resolve();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("actual FilmPlayer session lifecycle", () => {
  it("keeps a930-second movie active beyond the former five-minute cutoff and closes at its actual grant expiry", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json(
        grant({ durationSeconds: 930, expiresAt: Math.floor(Date.now() / 1000) + 990 }),
      ),
    );
    Object.assign(player, { duration: 930 });
    await start();
    expect(nodes.some((node) => node.type === "iframe")).toBe(true);
    vi.advanceTimersByTime(301000);
    await settle();
    expect(nodes.some((node) => node.type === "iframe")).toBe(true);
    vi.advanceTimersByTime(690000);
    await settle();
    expect(nodes.some((node) => node.type === "iframe")).toBe(false);
  });
  it("loads nothing before explicit activation and wires actual SDK events to owner-scoped progress", async () => {
    render();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(hooks.load).not.toHaveBeenCalled();
    await start();
    expect(nodes.find((node) => node.type === "iframe")?.props.src).toBe(
      "https://iframe.videodelivery.net/signed-test-token?autoplay=false&preload=none",
    );
    expect(hooks.load).toHaveBeenCalledOnce();
    playing();
    Object.assign(player, { paused: true });
    player.emit("pause");
    await settle();
    expect(progressRequests()).toHaveLength(1);
    const [path, init] = progressRequests()[0];
    expect(path).toBe(`/api/playback/${videoId}/progress`);
    expect(init.headers["X-AIVerse-Account"]).toBe(accountId);
    expect(JSON.parse(init.body)).toEqual({ sessionKey, watchedSeconds: 4 });
  });

  it.each([
    { iframeUrl: "https://evil.example/signed-token" },
    { iframeUrl: "https://iframe.videodelivery.net/token?autoplay=true" },
    { iframeUrl: "https://iframe.videodelivery.net/token/path" },
    { expiresAt: 1 },
    { expiresAt: 1792886400 + 301 },
    { durationSeconds: 1201 },
    { durationSeconds: null },
    { versionId: null },
    { tracking: { sessionKey, accountId: otherAccount, versionId } },
    { tracking: { sessionKey, accountId, versionId: videoId } },
  ])(
    "rejects unsafe or inconsistent grants before loading iframe or SDK: %j",
    async (overrides) => {
      fetchMock.mockResolvedValueOnce(Response.json(grant(overrides)));
      await start();
      expect(nodes.some((node) => node.type === "iframe")).toBe(false);
      expect(hooks.load).not.toHaveBeenCalled();
      expect(progressRequests()).toHaveLength(0);
    },
  );

  it.each(["guest", "private"])(
    "never records %s activity even if response contains tracking",
    async (mode) => {
      if (mode === "guest") hooks.accountId = null;
      else props.versionId = versionId;
      await start();
      playing();
      await click("Close player");
      await settle();
      expect(progressRequests()).toHaveLength(0);
      if (mode === "private") expect(fetchMock.mock.calls[0][0]).toContain(`?version=${versionId}`);
    },
  );

  it("flushes same-account activity on close and immediately stops native playback", async () => {
    await start();
    playing();
    await click("Close player");
    expect(fakeFrame?.src).toBe("about:blank");
    await settle();
    expect(player.pause).toHaveBeenCalledOnce();
    expect(progressRequests()).toHaveLength(1);
    expect(nodes.some((node) => node.type === "iframe")).toBe(false);
    player.emit("timeupdate");
    await settle();
    expect(progressRequests()).toHaveLength(1);
  });

  it.each([accountChangedEvent, accountUnavailableEvent])(
    "invalidates without a final write on %s",
    async (event) => {
      await start();
      playing();
      window.dispatchEvent(new Event(event));
      await settle();
      expect(fakeFrame?.src).toBe("about:blank");
      expect(nodes.some((node) => node.type === "iframe")).toBe(false);
      expect(progressRequests()).toHaveLength(0);
    },
  );

  it("ignores transient identity refresh but stops a confirmed account switch without flushing", async () => {
    await start();
    playing();
    hooks.ready = false;
    hooks.accountId = null;
    render();
    expect(nodes.some((node) => node.type === "iframe")).toBe(true);
    hooks.ready = true;
    hooks.accountId = otherAccount;
    await settle();
    expect(nodes.some((node) => node.type === "iframe")).toBe(false);
    expect(progressRequests()).toHaveLength(0);
  });

  it("stops the native frame on hidden pages even while SDK is unavailable", async () => {
    hooks.load.mockReturnValue(new Promise(() => {}));
    await start();
    documentTarget.visibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(fakeFrame?.src).toBe("about:blank");
    await settle();
    expect(nodes.some((node) => node.type === "iframe")).toBe(false);
    expect(progressRequests()).toHaveLength(0);
  });

  it("keeps native controls usable when SDK loading fails", async () => {
    hooks.load.mockRejectedValue(new Error("SDK offline"));
    await start();
    expect(nodes.some((node) => node.type === "iframe")).toBe(true);
    expect(
      nodes.some(
        (node) =>
          node.props.children ===
          "Playback activity could not connect. You can still use the video controls.",
      ),
    ).toBe(true);
    await click("Close player");
    expect(fakeFrame?.src).toBe("about:blank");
  });

  it("aborts a superseded request and ignores its late reply", async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const first = click("Play film");
    const firstSignal = fetchMock.mock.calls[0][1].signal;
    await click("Requesting playback…");
    await settle();
    expect(firstSignal.aborted).toBe(true);
    resolve(Response.json(grant({ iframeUrl: "https://iframe.videodelivery.net/obsolete-token" })));
    await first;
    await settle();
    expect(nodes.find((node) => node.type === "iframe")?.props.src).not.toContain("obsolete-token");
    expect(hooks.load).toHaveBeenCalledOnce();
  });

  it("cancels pending grants when another player activates", async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const pending = click("Play film");
    const signal = fetchMock.mock.calls[0][1].signal;
    window.dispatchEvent(new CustomEvent("aiverse:player-activate", { detail: "another-player" }));
    resolve(Response.json(grant()));
    await pending;
    await settle();
    expect(signal.aborted).toBe(true);
    expect(nodes.some((node) => node.type === "iframe")).toBe(false);
    expect(hooks.load).not.toHaveBeenCalled();
  });

  it("stops and removes an expired grant without sending late progress", async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json(grant({ expiresAt: Math.floor(Date.now() / 1000) + 5 })),
    );
    await start();
    playing(4);
    vi.advanceTimersByTime(1000);
    await settle();
    expect(fakeFrame?.src).toBe("about:blank");
    expect(nodes.some((node) => node.type === "iframe")).toBe(false);
    expect(progressRequests()).toHaveLength(0);
  });

  it("cleans SDK observers and native frame on unmount", async () => {
    await start();
    for (const effect of hooks.effects.values()) effect.cleanup?.();
    hooks.effects.clear();
    expect(fakeFrame?.src).toBe("about:blank");
    expect(player.pause).toHaveBeenCalledOnce();
    player.emit("playing");
    playing();
    await Promise.resolve();
    expect(progressRequests()).toHaveLength(0);
  });
});
