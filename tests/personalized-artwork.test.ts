import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const hooks = vi.hoisted(() => ({
  value: null as unknown,
  effect: null as null | (() => void | (() => void)),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: () => [
    hooks.value,
    (value: unknown) => {
      hooks.value = value;
    },
  ],
  useEffect: (effect: () => void | (() => void)) => {
    hooks.effect = effect;
  },
}));
import { PersonalizedShelf } from "../src/components/personalized-shelf";
import { FilmGrid } from "../src/components/catalog";
const version = "93000000-0000-4000-8000-000000000002";
const video = {
  id: "93000000-0000-4000-8000-000000000001",
  title: "Approved film",
  description: "Published metadata",
  creator: "93000000-0000-4000-8000-000000000003",
  format: "reel",
  duration: 90,
  genres: ["fantasy"],
  regions: ["korean"],
  languages: ["english"],
  tags: [],
  artwork: `/api/artwork/${version}`,
  status: "published",
  demo: false,
};
function nodes(tree: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object" || !("props" in tree)) return [];
  const n = tree as ReactElement<Record<string, unknown>>;
  return [n, ...nodes(n.props.children as ReactNode)];
}
beforeEach(() => {
  hooks.value = null;
  hooks.effect = null;
});
afterEach(() => vi.unstubAllGlobals());
describe("personalized shelf approved artwork", () => {
  it("retains a valid thumbnail-bearing published recommendation instead of dropping the shelf", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ recommendations: { items: [{ video }] } })),
    );
    expect(PersonalizedShelf()).toBeNull();
    const cleanup = hooks.effect?.();
    await vi.waitFor(() => expect(hooks.value).toEqual([video]));
    const grid = nodes(PersonalizedShelf()).find((n) => n.type === FilmGrid)!;
    expect(grid.props.videos).toEqual([video]);
    if (typeof cleanup === "function") cleanup();
  });
  it("rejects foreign tracking artwork and suppresses late replies after navigation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          recommendations: {
            items: [{ video: { ...video, artwork: "https://tracking.invalid/pixel.png" } }],
          },
        }),
      ),
    );
    PersonalizedShelf();
    hooks.effect?.();
    await new Promise((resolve) => setImmediate(resolve));
    expect(hooks.value).toBeNull();
    let resolveRequest!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    PersonalizedShelf();
    const cleanup = hooks.effect?.();
    if (typeof cleanup === "function") cleanup();
    resolveRequest(Response.json({ recommendations: { items: [{ video }] } }));
    await new Promise((resolve) => setImmediate(resolve));
    expect(hooks.value).toBeNull();
  });
});
