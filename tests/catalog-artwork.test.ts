import { beforeEach, describe, expect, it, vi } from "vitest";
import { isCatalogArtworkPath } from "../src/features/discovery/artwork";
import { reelVideoSchema } from "../src/features/reels/schema";
import { demoCatalog } from "./fixtures/catalog";
import { FilmGrid } from "../src/components/catalog";
import type { ReactElement, ReactNode } from "react";
const m = vi.hoisted(() => ({ rpc: vi.fn(), select: vi.fn(), single: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/image", () => ({ default: "img" }));
vi.mock("@/lib/env", () => ({
  getSupabaseConfig: () => ({ url: "http://127.0.0.1:55321", key: "fake-public-key" }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc: m.rpc, from: () => ({ select: m.select }) }),
}));
import { discover, findPublicVideo } from "../src/features/discovery/service";
const id = "93000000-0000-4000-8000-000000000001";
const versionId = "93000000-0000-4000-8000-000000000002";
const row = {
  id,
  version_id: versionId,
  creator_id: "93000000-0000-4000-8000-000000000003",
  title: "Approved film",
  description: "Actual published metadata",
  format: "reel",
  genres: ["fantasy"],
  regions: ["korean"],
  languages: ["english"],
  tags: [],
  ai_disclosed: true,
  published_at: "2026-10-25T00:00:00.000Z",
  duration_seconds: 90,
};
function nodes(tree: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object" || !("props" in tree)) return [];
  const element = tree as ReactElement<Record<string, unknown>>;
  return [element, ...nodes(element.props.children as ReactNode)];
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("AIVERSE_CATALOG_MODE", "live");
  m.select.mockReturnValue({ eq: () => ({ maybeSingle: m.single }) });
});
describe("approved revision artwork projection", () => {
  it("keeps930-second Movies in published discovery/detail without admitting them as Reels", async () => {
    const movie = { ...row, format: "movie", duration_seconds: 930, has_artwork: true };
    m.rpc.mockResolvedValue({
      data: {
        revision: "full-film",
        exact: { items: [movie], total: 1, nextId: null },
        broader: { label: "Broader suggestions", items: [] },
      },
      error: null,
    });
    const page = await discover(new URLSearchParams("format=movie&minDuration=900"));
    expect(page.exact.items[0]).toMatchObject({
      format: "movie",
      duration: 930,
      artwork: `/api/artwork/${versionId}`,
    });
    m.single.mockResolvedValue({ data: movie, error: null });
    expect(await findPublicVideo(id)).toMatchObject({ format: "movie", duration: 930 });
    expect(reelVideoSchema.safeParse(page.exact.items[0]).success).toBe(false);
  });
  it("accepts exact same-origin version artwork while rejecting foreign, executable and noncanonical paths", () => {
    expect(isCatalogArtworkPath(`/api/artwork/${versionId}`)).toBe(true);
    expect(isCatalogArtworkPath("/artwork/cat-v2.png")).toBe(true);
    for (const value of [
      `//evil.example/api/artwork/${versionId}`,
      `https://evil.example/${versionId}`,
      `/api/artwork/${versionId}?private=true`,
      `/api/artwork/${versionId}#token`,
      `/api/artwork/../${versionId}`,
      `/api/artwork/${versionId}.jpg`,
      "/api/private/avatar.png",
      "/artwork/a.svg",
      "javascript:alert(1)",
    ]) {
      expect(isCatalogArtworkPath(value)).toBe(false);
      expect(reelVideoSchema.safeParse({ ...demoCatalog[0], artwork: value }).success).toBe(false);
    }
    expect(
      reelVideoSchema.safeParse({ ...demoCatalog[0], artwork: `/api/artwork/${versionId}` })
        .success,
    ).toBe(true);
  });
  it.each([true, false, undefined])(
    "maps only approved presence=%s to an exact version image URL",
    async (has_artwork) => {
      const entry = { ...row, ...(has_artwork === undefined ? {} : { has_artwork }) };
      m.rpc.mockResolvedValue({
        data: {
          revision: "test",
          exact: { items: [entry], total: 1, nextId: null },
          broader: { label: "Broader suggestions", items: [] },
        },
        error: null,
      });
      const page = await discover(new URLSearchParams());
      expect(page.exact.items[0].artwork).toBe(has_artwork ? `/api/artwork/${versionId}` : "");
      expect(page.exact.items[0]).not.toHaveProperty("has_artwork");
      m.single.mockResolvedValue({ data: entry, error: null });
      expect((await findPublicVideo(id))?.artwork).toBe(page.exact.items[0].artwork);
      expect(m.select.mock.calls[0][0]).toContain("has_artwork");
    },
  );
  it("keeps the strict public allowlist when a provider URL or malformed presence is injected", async () => {
    for (const entry of [
      { ...row, provider_uid: "private" },
      { ...row, has_artwork: "true" },
    ]) {
      m.single.mockResolvedValue({ data: entry, error: null });
      await expect(findPublicVideo(id)).rejects.toThrow();
    }
  });
  it("bypasses Next image optimization for live artwork so each image request rechecks takedowns", () => {
    const live = { ...demoCatalog[0], id, demo: false, artwork: `/api/artwork/${versionId}` };
    const image = nodes(FilmGrid({ videos: [live] })).find((n) => n.type === "img")!;
    expect(image.props.unoptimized).toBe(true);
    expect(image.props.alt).toBe(`Thumbnail for ${live.title}`);
    const withoutArtwork = nodes(FilmGrid({ videos: [{ ...live, artwork: "" }] }));
    expect(withoutArtwork.some((n) => n.type === "img")).toBe(false);
  });
});
