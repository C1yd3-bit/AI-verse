import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
const m = vi.hoisted(() => ({
  config: vi.fn(),
  create: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  single: vi.fn(),
  collection: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ getSupabaseConfig: m.config }));
vi.mock("@supabase/supabase-js", () => ({ createClient: m.create }));
vi.mock("@/components/personalized-shelf", () => ({ PersonalizedShelf: () => null }));
import {
  catalogMode,
  CatalogUnavailableError,
  discover,
  findPublicVideo,
  publicCollection,
} from "../src/features/discovery/service";
import Home from "../src/app/page";
import { CatalogUnavailable } from "../src/components/catalog-unavailable";
import { FilmGrid } from "../src/components/catalog";
import { GET } from "../src/app/api/catalog/route";

const id = "94000000-0000-4000-8000-000000000001";
const published = {
  id,
  version_id: "94000000-0000-4000-8000-000000000002",
  creator_id: "94000000-0000-4000-8000-000000000003",
  title: "Published database film",
  description: "Creator-supplied public metadata",
  format: "movie",
  genres: ["sci-fi"],
  regions: [],
  languages: ["english"],
  tags: [],
  ai_disclosed: true,
  published_at: "2026-10-25T00:00:00.000Z",
  duration_seconds: 930,
};
const page = (items: unknown[] = []) => ({
  data: {
    revision: "11111111111111111111111111111111",
    exact: { items, total: items.length, nextId: null },
    broader: { label: "Broader suggestions", items: [] },
  },
  error: null,
});
function nodes(tree: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object" || !("props" in tree)) return [];
  const element = tree as ReactElement<Record<string, unknown>>;
  return [element, ...nodes(element.props.children as ReactNode)];
}
function text(tree: ReactNode): string {
  if (Array.isArray(tree)) return tree.map(text).join(" ");
  if (typeof tree === "string" || typeof tree === "number") return String(tree);
  if (tree && typeof tree === "object" && "props" in tree)
    return text((tree as ReactElement<{ children: ReactNode }>).props.children);
  return "";
}
beforeEach(() => {
  vi.resetAllMocks();
  m.config.mockReturnValue({ url: "http://127.0.0.1:55321", key: "test-public-key" });
  m.create.mockReturnValue({ rpc: m.rpc, from: m.from });
  const request = {
    select: () => request,
    eq: () => request,
    order: () => request,
    limit: () => request,
    contains: () => request,
    gt: () => request,
    maybeSingle: m.single,
    then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
      m.collection().then(resolve, reject),
  };
  m.from.mockReturnValue(request);
  m.collection.mockResolvedValue({ data: [], error: null });
  m.rpc.mockResolvedValue(page());
});
describe("published-only runtime catalog", () => {
  it.each([undefined, "demo", "live", "invalid"])(
    "always reads the published RPC with legacy catalog mode=%s",
    async (mode) => {
      vi.stubEnv("AIVERSE_CATALOG_MODE", mode);
      m.rpc.mockResolvedValue(page([published]));
      const result = await discover(new URLSearchParams());
      expect(catalogMode()).toBe("live");
      expect(result.mode).toBe("live");
      expect(result.exact.items.map((v) => v.id)).toEqual([id]);
      expect(result.exact.items[0]).toMatchObject({
        title: published.title,
        demo: false,
        artwork: "",
        duration: 930,
      });
      expect(m.rpc).toHaveBeenCalledWith(
        "discover_catalog",
        expect.objectContaining({ page_size: 20 }),
      );
    },
  );
  it("keeps an empty public database empty in discovery and the actual Home page", async () => {
    const result = await discover(new URLSearchParams());
    expect(result.exact).toEqual({ items: [], total: 0, nextCursor: null });
    const home = await Home();
    expect(text(home)).toContain("No films have been published yet.");
    expect(nodes(home).some((node) => node.type === FilmGrid)).toBe(false);
    expect(nodes(home).some((node) => node.props.className === "featured-film")).toBe(false);
  });
  it("renders actual published rows through Home instead of sample films", async () => {
    m.rpc.mockResolvedValue(page([published]));
    const home = await Home();
    const grid = nodes(home).find((node) => node.type === FilmGrid);
    expect(grid?.props.videos).toEqual([expect.objectContaining({ id, title: published.title })]);
    expect(text(home)).not.toContain("No films have been published yet.");
  });
  it("reports missing configuration for all real catalog reads and the public API without falling back", async () => {
    m.config.mockReturnValue(null);
    await expect(discover(new URLSearchParams())).rejects.toBeInstanceOf(CatalogUnavailableError);
    await expect(findPublicVideo(id)).rejects.toBeInstanceOf(CatalogUnavailableError);
    await expect(publicCollection({})).rejects.toBeInstanceOf(CatalogUnavailableError);
    expect((await Home()).type).toBe(CatalogUnavailable);
    const response = await GET(new Request("http://localhost/api/catalog"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Catalog unavailable. Try again later." });
    expect(m.create).not.toHaveBeenCalled();
  });
  it("does not replace unavailable database results with an empty catalog or sample cards", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "08006" } });
    await expect(discover(new URLSearchParams())).rejects.toBeInstanceOf(CatalogUnavailableError);
    expect((await Home()).type).toBe(CatalogUnavailable);
    expect((await GET(new Request("http://localhost/api/catalog"))).status).toBe(503);
    m.single.mockResolvedValue({ data: null, error: { code: "08006" } });
    await expect(findPublicVideo(id)).rejects.toBeInstanceOf(CatalogUnavailableError);
  });
  it.each([
    "somewhere-after-midnight",
    "one-table-for-two",
    "last-greenhouse",
    "tides-of-tomorrow",
  ])("retired sample permalink %s cannot resolve or query private records", async (slug) => {
    vi.stubEnv("AIVERSE_CATALOG_MODE", "demo");
    expect(await findPublicVideo(slug)).toBeNull();
    expect(m.create).not.toHaveBeenCalled();
  });
  it("preserves missing public UUID as not found and selects only the public projection", async () => {
    m.single.mockResolvedValue({ data: null, error: null });
    expect(await findPublicVideo(id)).toBeNull();
    expect(m.from).toHaveBeenCalledExactlyOnceWith("public_catalog");
  });
  it("keeps tag collections empty and unavailable according to actual public results", async () => {
    vi.stubEnv("AIVERSE_CATALOG_MODE", "demo");
    expect(await publicCollection({ tag: "cat" })).toEqual({
      creator: null,
      items: [],
      nextId: null,
    });
    expect(m.from).toHaveBeenCalledExactlyOnceWith("public_catalog");
    m.collection.mockResolvedValue({ data: null, error: { code: "08006" } });
    await expect(publicCollection({ tag: "cat" })).rejects.toBeInstanceOf(CatalogUnavailableError);
  });
  it("classifies malformed or failed provider reads as unavailable instead of user filter errors", async () => {
    m.rpc.mockResolvedValue(page([{ ...published, provider_uid: "must-not-leak" }]));
    expect((await GET(new Request("http://localhost/api/catalog"))).status).toBe(503);
    m.rpc.mockRejectedValue(new Error("connection reset"));
    expect((await GET(new Request("http://localhost/api/catalog"))).status).toBe(503);
    expect((await GET(new Request("http://localhost/api/catalog?limit=invalid"))).status).toBe(400);
  });
  it("bounds anonymous public fetches and preserves cancellation without response caching", async () => {
    await discover(new URLSearchParams());
    const options = m.create.mock.calls[0][2] as { global: { fetch: typeof fetch } };
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const request = new AbortController();
    request.abort();
    const fetch = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    try {
      await options.global.fetch("http://127.0.0.1:55321/rest/v1/public_catalog", {
        signal: request.signal,
        cache: "force-cache",
      });
      expect(timeout).toHaveBeenCalledWith(12_000);
      expect(fetch.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
      expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    } finally {
      timeout.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
