import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cursor: 0,
  values: [] as unknown[],
  effects: [] as { run: () => void | (() => void); deps: unknown[]; cleanup?: () => void }[],
  pending: [] as (() => void)[],
  collection: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = state.cursor++;
    if (!(index in state.values)) state.values[index] = initial;
    return [
      state.values[index],
      (next: unknown) => {
        state.values[index] = typeof next === "function" ? next(state.values[index]) : next;
      },
    ];
  },
  useEffect: (run: () => void | (() => void), deps: unknown[]) => {
    const index = state.cursor++;
    const previous = state.effects[index];
    if (
      previous &&
      deps.length === previous.deps.length &&
      deps.every((value, offset) => Object.is(value, previous.deps[offset]))
    )
      return;
    state.pending.push(() => {
      previous?.cleanup?.();
      state.effects[index] = { run, deps, cleanup: run() || undefined };
    });
  },
}));
vi.mock("next/image", () => ({ default: "img" }));
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("@/features/discovery/service", () => ({ publicCollection: state.collection }));
import { ArtworkCarousel, type AuthArtwork } from "../src/components/auth-artwork-carousel";
import { AuthExperience } from "../src/components/auth-experience";

type Node = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function nodes(tree: ReactNode): Node[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object" || !("props" in tree)) return [];
  const n = tree as Node;
  return [n, ...nodes(n.props.children)];
}
const entries: AuthArtwork[] = [1, 2].map((n) => ({
  id: `film-${n}`,
  title: `Published story ${n}`,
  artwork: `/api/artwork/92000000-0000-4000-8000-00000000000${n}`,
}));
function render(films = entries) {
  state.cursor = 0;
  const tree = ArtworkCarousel({ films });
  state.pending.splice(0).forEach((run) => run());
  return nodes(tree);
}
function click(node: Node) {
  (node.props.onClick as () => void)();
}
let motion: EventTarget & { matches: boolean };
let documentEvents: EventTarget & { hidden: boolean };
beforeEach(() => {
  vi.useFakeTimers();
  state.cursor = 0;
  state.values = [];
  state.effects = [];
  state.pending = [];
  state.collection.mockReset();
  motion = Object.assign(new EventTarget(), { matches: false });
  documentEvents = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal("document", documentEvents);
  vi.stubGlobal("window", { matchMedia: () => motion, setInterval, clearInterval });
});
afterEach(() => {
  state.effects.forEach((effect) => effect.cleanup?.());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("published authentication artwork", () => {
  it("keeps account children usable when public catalog is empty or unavailable", async () => {
    for (const result of [Promise.resolve({ items: [] }), Promise.reject(new Error("offline"))]) {
      state.collection.mockReturnValueOnce(result);
      const tree = nodes(await AuthExperience({ children: "Account form" }));
      expect(tree.find((n) => n.type === ArtworkCarousel)?.props.films).toEqual([]);
      expect(tree.some((n) => n.props.children === "Account form")).toBe(true);
    }
  });
  it("passes only four published approved artwork projections without private fields or sample assets", async () => {
    const valid = Array.from({ length: 6 }, (_, n) => ({
      ...entries[0],
      id: `real-${n}`,
      status: "published",
      demo: false,
      providerToken: "private",
      creator: "private creator",
    }));
    state.collection.mockResolvedValue({
      items: [
        { ...valid[0], status: "draft" },
        { ...valid[0], demo: true },
        { ...valid[0], artwork: "/artwork/sample.png" },
        { ...valid[0], artwork: "https://foreign.invalid/image.jpg" },
        { ...valid[0], artwork: "/api/artwork/not-a-version" },
        ...valid,
      ],
    });
    const tree = nodes(await AuthExperience({ children: null }));
    const films = tree.find((n) => n.type === ArtworkCarousel)!.props.films as AuthArtwork[];
    expect(films).toHaveLength(4);
    expect(films.map((film) => Object.keys(film).sort())).toEqual(
      Array(4).fill(["artwork", "id", "title"]),
    );
    expect(films.every((film) => film.id.startsWith("real-"))).toBe(true);
    expect(JSON.stringify(films)).not.toMatch(/private|sample|provider/);
  });
  it("shows quiet brand text without fabricated titles, images or carousel controls for zero films", () => {
    const tree = render([]);
    expect(tree[0].props["aria-label"]).toBe("Welcome to AIVerse");
    expect(tree.some((n) => n.type === "img" || n.type === "button")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("shows one published image without redundant carousel controls or automatic changes", () => {
    const tree = render(entries.slice(0, 1));
    expect(tree.filter((n) => n.type === "img")).toHaveLength(1);
    expect(tree.find((n) => n.type === "img")?.props.unoptimized).toBe(true);
    expect(tree.some((n) => n.type === "button")).toBe(false);
    render(entries.slice(0, 1));
    expect(vi.getTimerCount()).toBe(0);
  });
  it("permits native thumbnail button selection and pauses rotation on hover or focus", () => {
    let tree = render();
    tree = render();
    expect(vi.getTimerCount()).toBe(1);
    click(tree.find((n) => n.props["aria-label"] === "Show Published story 2")!);
    tree = render();
    expect(tree.find((n) => n.props.className === "auth-film-title")?.props.children).toBe(
      "Published story 2",
    );
    (tree[0].props.onMouseEnter as () => void)();
    render();
    expect(vi.getTimerCount()).toBe(0);
    (tree[0].props.onMouseLeave as () => void)();
    tree = render();
    (tree[0].props.onFocusCapture as () => void)();
    render();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("honors reduced motion and hidden pages, with cleanup of automatic changes", () => {
    render();
    render();
    expect(vi.getTimerCount()).toBe(1);
    documentEvents.hidden = true;
    documentEvents.dispatchEvent(new Event("visibilitychange"));
    render();
    expect(vi.getTimerCount()).toBe(0);
    documentEvents.hidden = false;
    documentEvents.dispatchEvent(new Event("visibilitychange"));
    render();
    motion.matches = true;
    motion.dispatchEvent(new Event("change"));
    const tree = render();
    expect(vi.getTimerCount()).toBe(0);
    expect(tree.find((n) => n.props.className === "auth-carousel-toggle")?.props.disabled).toBe(
      true,
    );
  });
  it("removes revoked or failed images and returns to brand-only state when none remain", () => {
    let tree = render();
    for (const image of tree.filter((n) => n.type === "img" && n.props.onError))
      (image.props.onError as () => void)();
    tree = render();
    expect(tree[0].props["aria-label"]).toBe("Welcome to AIVerse");
    expect(tree.some((n) => n.type === "img")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
