import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoCatalog } from "./fixtures/catalog";
import {
  createReelQuery,
  reelVideoSchema,
  reelViewerSchema,
  type ReelViewerData,
} from "../src/features/reels/schema";
import { accountChangedEvent } from "../src/lib/appearance";

type Effect = { deps: unknown[]; cleanup?: () => void };
const hooks = vi.hoisted(() => ({
  cursor: 0,
  values: [] as unknown[],
  effects: new Map<number, Effect>(),
  pending: [] as (() => void)[],
  writes: 0,
  path: "/reels/one-table-for-two",
  router: { refresh: vi.fn() },
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values))
      hooks.values[index] = typeof initial === "function" ? initial() : initial;
    return [
      hooks.values[index],
      (value: unknown) => {
        hooks.writes++;
        hooks.values[index] = typeof value === "function" ? value(hooks.values[index]) : value;
      },
    ];
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = { current: initial };
    return hooks.values[index];
  },
  useCallback: (callback: unknown, deps: unknown[]) => {
    const index = hooks.cursor++;
    const previous = hooks.values[index] as { callback: unknown; deps: unknown[] } | undefined;
    if (!previous || !deps.every((value, offset) => Object.is(value, previous.deps[offset])))
      hooks.values[index] = { callback, deps };
    return (hooks.values[index] as { callback: unknown }).callback;
  },
  useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
    const index = hooks.cursor++,
      previous = hooks.effects.get(index);
    if (previous && deps.every((value, offset) => Object.is(value, previous.deps[offset]))) return;
    hooks.pending.push(() => {
      previous?.cleanup?.();
      hooks.effects.set(index, { deps, cleanup: effect() });
    });
  },
}));
vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("next/image", () => ({ default: "img" }));
vi.mock("next/navigation", () => ({
  useRouter: () => hooks.router,
  usePathname: () => hooks.path,
}));
vi.mock("../src/components/film-player", () => ({ FilmPlayer: "film-player" }));
import { ReelViewer, reelInputOwnsGesture } from "../src/components/reel-viewer";
import { FilmGrid } from "../src/components/catalog";
import { DiscoveryResults } from "../src/components/discovery-results";
import { AppShell } from "../src/components/app-shell";

type Node = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
class FakeElement extends EventTarget {
  owned = false;
  clientHeight = 900;
  scrollTop = 0;
  focus = vi.fn(() => {
    documentTarget.activeElement = this;
  });
  closest() {
    return this.owned ? this : null;
  }
}
let initialData: ReelViewerData;
let region: FakeElement;
let documentTarget: EventTarget & {
  activeElement: FakeElement | null;
  visibilityState: string;
  querySelector: ReturnType<typeof vi.fn>;
};
let windowTarget: EventTarget & {
  location: { href: string };
  history: { pushState: ReturnType<typeof vi.fn> };
};
let fetchMock: ReturnType<typeof vi.fn>;
let nodes: Node[];
let now = 1000;
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
  nodes = elements(ReelViewer({ initialData }));
  const container = nodes.find((node) => node.props.className === "reel-gesture-region")!;
  (container.props.ref as { current: unknown }).current = region;
  for (const effect of hooks.pending.splice(0)) effect();
  return nodes;
}
async function settle() {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
    render();
  }
}
function strings(node: ReactNode): string {
  if (typeof node === "string") return node;
  return elements(node)
    .flatMap((part) =>
      [part.props.children].flat(Infinity).filter((child) => typeof child === "string"),
    )
    .join(" ");
}
function button(text: string) {
  const node = render().find((node) => node.type === "button" && strings(node).trim() === text);
  if (!node) throw new Error(`Missing ${text}`);
  return node;
}
function click(text: string) {
  return (button(text).props.onClick as () => void)();
}
function title() {
  return render().find((node) => node.type === "h1")?.props.children;
}
function keyDown(key: string, target: FakeElement = documentTarget.activeElement ?? region) {
  const preventDefault = vi.fn();
  const container = render().find((node) => node.props.className === "reel-gesture-region")!;
  (container.props.onKeyDown as (event: unknown) => void)({ key, target, preventDefault });
  return preventDefault;
}
function wheel(deltaY = 120, extras: object = {}) {
  render();
  const event = Object.assign(new Event("wheel", { cancelable: true }), {
    deltaY,
    deltaX: 0,
    deltaMode: 0,
    ctrlKey: false,
    ...extras,
  });
  region.dispatchEvent(event);
  render();
  return event;
}
function touch(type: string, x: number, y: number, count = 1) {
  render();
  const point = { clientX: x, clientY: y };
  const event = Object.assign(new Event(type, { cancelable: true }), {
    touches: Array.from({ length: count }, () => point),
    changedTouches: [point],
  });
  region.dispatchEvent(event);
  render();
  return event;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
function page(items = [demoCatalog[0]], nextCursor: string | null = null) {
  return {
    mode: initialData.mode,
    query: initialData.query,
    exact: { items, total: 3, nextCursor },
    broader: { label: "Broader", items: [] },
  };
}
function setLive() {
  initialData = reelViewerSchema.parse({
    ...initialData,
    mode: "live",
    initialId: "84000000-0000-4000-8000-000000000001",
    items: initialData.items.map((item, index) => ({
      ...item,
      id: `84000000-0000-4000-8000-00000000000${index + 1}`,
      creator: "84000000-0000-4000-8000-000000000009",
      demo: false,
      artwork: "",
    })),
  });
}
function unmount() {
  for (const effect of hooks.effects.values()) effect.cleanup?.();
  hooks.effects.clear();
}
beforeEach(() => {
  hooks.cursor = 0;
  hooks.values = [];
  hooks.effects = new Map();
  hooks.pending = [];
  hooks.writes = 0;
  hooks.path = "/reels/one-table-for-two";
  hooks.router.refresh.mockReset();
  initialData = reelViewerSchema.parse({
    mode: "demo",
    query: createReelQuery(new URLSearchParams()),
    items: [demoCatalog[2], demoCatalog[0]],
    initialId: "one-table-for-two",
    nextCursor: null,
    backHref: "/reels?format=reel",
  });
  region = new FakeElement();
  documentTarget = Object.assign(new EventTarget(), {
    activeElement: null as FakeElement | null,
    visibilityState: "visible",
    querySelector: vi.fn(() => null),
  });
  windowTarget = Object.assign(new EventTarget(), {
    location: { href: "http://localhost:3000/reels/one-table-for-two?format=reel" },
    history: {
      pushState: vi.fn((_state: unknown, _unused: string, url: string) => {
        windowTarget.location.href = new URL(url, "http://localhost:3000").href;
      }),
    },
  });
  vi.stubGlobal("Element", FakeElement);
  vi.stubGlobal("window", windowTarget);
  vi.stubGlobal("document", documentTarget);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  now = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
});
afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("actual immersive reel viewer handlers", () => {
  it("renders supplied isolated artwork without requesting a player, stream or catalog on entry", () => {
    render();
    expect(title()).toBe("One table for two");
    expect(nodes.find((node) => node.props.className === "reel-stage-art")?.props.src).toBe(
      initialData.items[0].artwork,
    );
    expect(nodes.filter((node) => node.type === "img").map((node) => node.props.src)).toEqual(
      initialData.items.map((item) => item.artwork),
    );
    expect(nodes.some((node) => node.type === "film-player" || node.type === "iframe")).toBe(false);
    expect(strings(nodes.find((node) => node.props.className === "reel-disclosure"))).toBe(
      "AI-created \u00b7 Reviewed before publication",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(region.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(button("Previous").props.disabled).toBe(true);
    expect(button("Next").props.disabled).toBe(false);
  });
  it("navigates bounded records, updates canonical native history and does not loop at the end", () => {
    click("Next");
    expect(title()).toBe("Somewhere, after midnight");
    expect(windowTarget.history.pushState).toHaveBeenCalledExactlyOnceWith(
      null,
      "",
      "/reels/somewhere-after-midnight?format=reel",
    );
    expect(button("Next").props.disabled).toBe(true);
    click("Next");
    expect(windowTarget.history.pushState).toHaveBeenCalledTimes(1);
    click("Previous");
    expect(title()).toBe("One table for two");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("restores viewer focus before the clicked Next becomes disabled so ArrowUp works immediately", () => {
    render();
    const focusedNextButton = new FakeElement();
    focusedNextButton.owned = true;
    documentTarget.activeElement = focusedNextButton;
    click("Next");
    expect(button("Next").props.disabled).toBe(true);
    expect(documentTarget.activeElement).toBe(region);
    expect(keyDown("ArrowUp")).toHaveBeenCalled();
    expect(title()).toBe("One table for two");
  });
  it("supports focused arrow navigation and ignores typing, native player controls and modal input", () => {
    expect(keyDown("ArrowDown")).toHaveBeenCalled();
    expect(title()).toBe("Somewhere, after midnight");
    const input = new FakeElement();
    input.owned = true;
    expect(reelInputOwnsGesture(input)).toBe(true);
    expect(keyDown("ArrowUp", input)).not.toHaveBeenCalled();
    expect(title()).toBe("Somewhere, after midnight");
    documentTarget.querySelector.mockReturnValue({});
    expect(keyDown("ArrowUp")).not.toHaveBeenCalled();
    documentTarget.querySelector.mockReturnValue(null);
    keyDown("ArrowUp");
    expect(title()).toBe("One table for two");
  });
  it("uses a local wheel gesture and retains momentum cooldown across changed reels", () => {
    initialData = reelViewerSchema.parse({
      ...initialData,
      items: [...initialData.items, { ...demoCatalog[0], id: "third-reel", title: "Third reel" }],
    });
    expect(wheel(120).defaultPrevented).toBe(true);
    expect(title()).toBe("Somewhere, after midnight");
    now += 20;
    wheel(180);
    expect(title()).toBe("Somewhere, after midnight");
    now += 500;
    wheel(120);
    expect(title()).toBe("Third reel");
    expect(wheel(120).defaultPrevented).toBe(false);
    expect(title()).toBe("Third reel");
    expect(windowTarget.history.pushState).toHaveBeenCalledTimes(2);
  });
  it("ignores horizontal scrolling and pinch-zoom wheels", () => {
    expect(wheel(20, { deltaX: 100 }).defaultPrevented).toBe(false);
    expect(wheel(120, { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(title()).toBe("One table for two");
  });
  it("moves on a vertical touch swipe, preserves horizontal input and lets end-of-queue touch scroll naturally", () => {
    touch("touchstart", 100, 400);
    expect(touch("touchmove", 100, 300).defaultPrevented).toBe(true);
    touch("touchend", 100, 280);
    expect(title()).toBe("Somewhere, after midnight");
    touch("touchstart", 100, 400);
    expect(touch("touchmove", 100, 300).defaultPrevented).toBe(false);
    touch("touchend", 100, 280);
    expect(title()).toBe("Somewhere, after midnight");
    touch("touchstart", 100, 200);
    touch("touchend", 240, 260);
    expect(title()).toBe("Somewhere, after midnight");
    touch("touchstart", 100, 200);
    touch("touchend", 100, 300);
    expect(title()).toBe("One table for two");
  });
  it("mounts exactly one keyed live FilmPlayer and replaces it on selection change", () => {
    setLive();
    render();
    let players = nodes.filter((node) => node.type === "film-player");
    expect(players).toHaveLength(1);
    expect(players[0].key).toBe(initialData.items[0].id);
    click("Next");
    render();
    players = nodes.filter((node) => node.type === "film-player");
    expect(players).toHaveLength(1);
    expect(players[0].props.videoId).toBe(initialData.items[1].id);
    expect(players[0].key).toBe(initialData.items[1].id);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("restores matching history selections without pushing another entry and refreshes unknown contexts", () => {
    click("Next");
    windowTarget.location.href = "http://localhost:3000/reels/one-table-for-two?format=reel";
    windowTarget.dispatchEvent(new Event("popstate"));
    expect(title()).toBe("One table for two");
    expect(windowTarget.history.pushState).toHaveBeenCalledTimes(1);
    windowTarget.location.href = "http://localhost:3000/reels/unknown-reel?format=reel";
    windowTarget.dispatchEvent(new Event("popstate"));
    render();
    expect(hooks.router.refresh).toHaveBeenCalledTimes(1);
    expect(button("Next").props.disabled).toBe(true);
  });
  it("restores a queryless initial permalink after canonical Next and Back without a stale refresh", () => {
    windowTarget.location.href = "http://localhost:3000/reels/one-table-for-two";
    render();
    click("Next");
    expect(windowTarget.location.href).toBe(
      "http://localhost:3000/reels/somewhere-after-midnight?format=reel",
    );
    windowTarget.location.href = "http://localhost:3000/reels/one-table-for-two";
    windowTarget.dispatchEvent(new Event("popstate"));
    expect(title()).toBe("One table for two");
    expect(button("Previous").props.disabled).toBe(true);
    expect(button("Next").props.disabled).toBe(false);
    expect(hooks.router.refresh).not.toHaveBeenCalled();
    // Forward uses the canonical entry created by Next and remains the same queue.
    windowTarget.location.href = "http://localhost:3000/reels/somewhere-after-midnight?format=reel";
    windowTarget.dispatchEvent(new Event("popstate"));
    expect(title()).toBe("Somewhere, after midnight");
    expect(windowTarget.history.pushState).toHaveBeenCalledTimes(1);
    expect(hooks.router.refresh).not.toHaveBeenCalled();
  });
  it.each([
    "q=reels&region=any",
    "format=reels",
    "format=all&q=reels",
    "limit=20&region=global&format=reel",
  ])("accepts semantically equivalent historical filters: %s", (search) => {
    render();
    click("Next");
    windowTarget.location.href = `http://localhost:3000/reels/one-table-for-two?${search}`;
    windowTarget.dispatchEvent(new Event("popstate"));
    expect(title()).toBe("One table for two");
    expect(button("Next").props.disabled).toBe(false);
    expect(hooks.router.refresh).not.toHaveBeenCalled();
  });
  it("canonicalizes conversational aliases, OR filters, language order and numeric page size together", () => {
    const source = new URLSearchParams(
      "genre=animals&genre=romance&format=reel&language=english&language=korean&limit=7",
    );
    initialData = reelViewerSchema.parse({
      ...initialData,
      query: createReelQuery(source),
      backHref: `/reels?${source}`,
    });
    render();
    click("Next");
    windowTarget.location.href =
      "http://localhost:3000/reels/one-table-for-two?language=korean&q=romantic+or+animals+movies&format=REELS&language=english&limit=07";
    windowTarget.dispatchEvent(new Event("popstate"));
    expect(title()).toBe("One table for two");
    expect(hooks.router.refresh).not.toHaveBeenCalled();
    expect(button("Next").props.disabled).toBe(false);
  });
  it("still refreshes changed filters, cursors and page sizes instead of retaining an incompatible live queue", () => {
    setLive();
    render();
    for (const search of [
      "format=reel&genre=romance",
      "format=reel&cursor=another-page",
      "format=reel&limit=7",
      "format=reel&unknown=1",
    ]) {
      windowTarget.location.href = `http://localhost:3000/reels/${initialData.initialId}?${search}`;
      windowTarget.dispatchEvent(new Event("popstate"));
      render();
      expect(nodes.filter((node) => node.type === "film-player")).toHaveLength(0);
      expect(button("Next").props.disabled).toBe(true);
    }
    expect(hooks.router.refresh).toHaveBeenCalledTimes(4);
  });
  it("unmounts the current live player immediately when history leaves its current route context", () => {
    setLive();
    render();
    windowTarget.location.href = "http://localhost:3000/reels";
    windowTarget.dispatchEvent(new Event("popstate"));
    render();
    expect(nodes.filter((node) => node.type === "film-player")).toHaveLength(0);
  });
  it("keeps back, search and current-film details as working route links", () => {
    render();
    expect(nodes.find((node) => node.props.className === "reel-back")?.props.href).toBe(
      initialData.backHref,
    );
    expect(nodes.find((node) => node.props.className === "reel-search")?.props.href).toBe(
      "/search",
    );
    expect(nodes.find((node) => node.props.className === "reel-details")?.props.href).toBe(
      "/watch/one-table-for-two",
    );
    click("Next");
    render();
    expect(nodes.find((node) => node.props.className === "reel-details")?.props.href).toBe(
      "/watch/somewhere-after-midnight",
    );
  });
});

describe("explicit bounded catalog loading and cancellation", () => {
  beforeEach(() => {
    initialData = { ...initialData, items: [initialData.items[0]], nextCursor: "page-two" };
  });
  it("loads only on explicit action, validates the response and makes next navigation available", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(page()), { status: 200 }));
    render();
    expect(fetchMock).not.toHaveBeenCalled();
    click("Load more reels");
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/catalog?format=reel&cursor=page-two&limit=20");
    expect(button("Next").props.disabled).toBe(false);
    expect(title()).toBe("One table for two");
    click("Next");
    expect(title()).toBe("Somewhere, after midnight");
  });
  it.each(["query", "mode", "private"])(
    "rejects %s contamination with retry recovery and no queue mutation",
    async (change) => {
      const reply = page();
      if (change === "query") reply.query = createReelQuery(new URLSearchParams("genre=romance"));
      if (change === "mode") reply.mode = "live";
      if (change === "private")
        reply.exact.items = [{ ...demoCatalog[0], status: "pending_review" }];
      fetchMock.mockResolvedValue(new Response(JSON.stringify(reply), { status: 200 }));
      click("Load more reels");
      await settle();
      expect(button("Next").props.disabled).toBe(true);
      expect(nodes.some((node) => node.props.role === "alert")).toBe(true);
      expect(button("Load more reels").props.disabled).toBe(false);
    },
  );
  it("preserves the queue and offers a truthful restart on stale catalog400", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 400 }));
    click("Load more reels");
    await settle();
    expect(strings(nodes.find((node) => node.props.role === "alert"))).toContain("Return to Reels");
    expect(button("Next").props.disabled).toBe(true);
  });
  it.each(["hidden", "identity", "unmount"])(
    "aborts pending load and ignores its late response after %s",
    async (change) => {
      const wait = deferred<Response>();
      fetchMock.mockReturnValue(wait.promise);
      click("Load more reels");
      const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
      if (change === "hidden") {
        documentTarget.visibilityState = "hidden";
        documentTarget.dispatchEvent(new Event("visibilitychange"));
      } else if (change === "identity") windowTarget.dispatchEvent(new Event(accountChangedEvent));
      else unmount();
      expect(signal.aborted).toBe(true);
      const writes = hooks.writes;
      wait.resolve(new Response(JSON.stringify(page()), { status: 200 }));
      for (let i = 0; i < 20; i++) await Promise.resolve();
      expect(hooks.writes).toBe(writes);
    },
  );
  it("aborts a load when moving to a previously loaded reel and never applies its late additions", async () => {
    initialData = {
      ...initialData,
      items: [initialData.items[0], reelVideoSchema.parse(demoCatalog[0])],
      initialId: demoCatalog[0].id,
    };
    const wait = deferred<Response>();
    fetchMock.mockReturnValue(wait.promise);
    click("Load more reels");
    click("Previous");
    expect((fetchMock.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true);
    wait.resolve(
      new Response(JSON.stringify(page([{ ...demoCatalog[0], id: "third-reel" }])), {
        status: 200,
      }),
    );
    await settle();
    click("Next");
    expect(button("Next").props.disabled).toBe(true);
  });
  it("does not let an old aborted response clear a later pending request or replace its data", async () => {
    const old = deferred<Response>(),
      fresh = deferred<Response>();
    fetchMock.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    click("Load more reels");
    documentTarget.visibilityState = "hidden";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    documentTarget.visibilityState = "visible";
    click("Load more reels");
    old.resolve(
      new Response(JSON.stringify(page([{ ...demoCatalog[0], id: "obsolete-reel" }])), {
        status: 200,
      }),
    );
    await settle();
    expect(button("Loading reels…").props.disabled).toBe(true);
    fresh.resolve(new Response(JSON.stringify(page()), { status: 200 }));
    await settle();
    click("Next");
    expect(title()).toBe("Somewhere, after midnight");
  });
});

describe("narrow browse and shell integration", () => {
  it("keeps ordinary grids on Watch and routes opt-in Reels cards to the preserved viewer context", () => {
    const regular = elements(FilmGrid({ videos: [demoCatalog[2]] })).filter(
      (node) => node.type === "a",
    );
    expect(regular.every((node) => node.props.href === "/watch/one-table-for-two")).toBe(true);
    const reels = elements(
      FilmGrid({
        videos: [demoCatalog[2]],
        layout: "portrait",
        reelViewerHref: "/reels?format=reel&cursor=source",
      }),
    ).filter((node) => node.type === "a");
    expect(
      reels.every(
        (node) =>
          node.props.href === "/reels/one-table-for-two?format=reel&cursor=source" &&
          node.props.prefetch === false,
      ),
    ).toBe(true);
  });
  it("opts only exact Reels results into viewer links and leaves broader results on details", () => {
    const pageValue = {
      mode: "demo" as const,
      query: initialData.query,
      exact: { items: [demoCatalog[2]], total: 1, nextCursor: null },
      broader: { label: "Broader", items: [demoCatalog[0]] },
    };
    const grids = elements(
      DiscoveryResults({
        page: pageValue,
        path: "/reels",
        layout: "portrait",
        reelViewerHref: initialData.backHref,
      }),
    ).filter((node) => node.type === FilmGrid);
    expect(grids).toHaveLength(2);
    expect(grids[0].props.reelViewerHref).toBe(initialData.backHref);
    expect(grids[1].props.reelViewerHref).toBeUndefined();
  });
  it("marks nested Reels active and removes only viewer header/footer chrome", () => {
    hooks.cursor = 0;
    const viewer = elements(AppShell({ children: null }));
    expect(
      viewer.find((node) => node.type === "a" && node.props.href === "/reels")?.props[
        "aria-current"
      ],
    ).toBe("page");
    expect(viewer.some((node) => node.type === "header" || node.type === "footer")).toBe(false);
    hooks.cursor = 0;
    hooks.path = "/movies";
    const ordinary = elements(AppShell({ children: null }));
    expect(ordinary.some((node) => node.type === "header")).toBe(true);
    expect(ordinary.some((node) => node.type === "footer")).toBe(true);
  });
});
