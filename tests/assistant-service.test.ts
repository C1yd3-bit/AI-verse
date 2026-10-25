import { beforeEach, describe, expect, it, vi } from "vitest";
import { demoCatalog } from "./fixtures/catalog";
import { parseDiscoveryParams, searchCatalog } from "../src/features/discovery/query";
const m = vi.hoisted(() => ({ discover: vi.fn(), find: vi.fn(), mode: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/discovery/service", () => ({
  discover: m.discover,
  findPublicVideo: m.find,
  catalogMode: m.mode,
}));
import { askAssistant } from "../src/features/assistant/service";
import { assistantResponseSchema } from "../src/features/assistant/schema";

beforeEach(() => {
  vi.resetAllMocks();
  m.mode.mockReturnValue("demo");
  m.find.mockImplementation(
    async (id: string) =>
      demoCatalog.find((video) => video.id === id && video.status === "published") ?? null,
  );
  m.discover.mockImplementation(async (params: URLSearchParams) => ({
    mode: "demo",
    query: parseDiscoveryParams(params),
    ...searchCatalog(demoCatalog, parseDiscoveryParams(params), {
      catalogVersion: "test",
      limit: Number(params.get("limit") ?? 20),
    }),
  }));
});
describe("grounded assistant service", () => {
  it("validates complete service payloads and rejects private or executable response additions", async () => {
    const result = await askAssistant({ message: "reels" });
    expect(assistantResponseSchema.safeParse(result).success).toBe(true);
    const first = result.exact.items[0];
    const changedVideo = (patch: object) => ({
      ...result,
      exact: { ...result.exact, items: [{ ...first, video: { ...first.video, ...patch } }] },
    });
    for (const invalid of [
      { ...result, privateNotes: "secret" },
      changedVideo({ providerId: "private" }),
      changedVideo({ status: "pending_review" }),
      changedVideo({ id: "../private" }),
      changedVideo({ artwork: "https://tracking.example/pixel.png" }),
      changedVideo({ artwork: "//tracking.example/pixel.png" }),
      changedVideo({ artwork: "/artwork/../private.png" }),
      changedVideo({ artwork: "/artwork/image.svg" }),
      { ...result, fusionUrl: "javascript:alert(1)" },
      { ...result, searchUrl: "//external.example/search" },
      { ...result, searchUrl: "/search?format=movie" },
      { ...result, fusionUrl: "/fusion?format=reel&unknown=1" },
      { ...result, exact: { ...result.exact, total: 0 } },
      { ...result, broader: { ...result.broader, items: [first] } },
    ])
      expect(assistantResponseSchema.safeParse(invalid).success).toBe(false);
    const withoutArtwork: Partial<typeof first.video> = { ...first.video };
    delete withoutArtwork.artwork;
    expect(
      assistantResponseSchema.safeParse({
        ...result,
        exact: { ...result.exact, items: [{ ...first, video: withoutArtwork }] },
      }).success,
    ).toBe(false);
    expect(assistantResponseSchema.safeParse(changedVideo({ artwork: "" })).success).toBe(true);
  });
  it("uses public discovery and metadata-only explanations, bounded cards and canonical URLs", async () => {
    const result = await askAssistant({ message: "reels" });
    expect(result.exact.total).toBe(2);
    expect(result.exact.items.length).toBeLessThanOrEqual(3);
    expect(result.exact.items.map((item) => item.video.id)).not.toContain("unreviewed-demo");
    for (const item of result.exact.items) {
      expect(item.video.status).toBe("published");
      expect(item.reason).toContain(item.video.duration === 75 ? "1m 15s" : "2m 14s");
      expect(item.reason).not.toMatch(/popular|views|because you|ethnicity/i);
    }
    expect(result.fusionUrl).toBe("/fusion?format=reel");
    expect(result.searchUrl).toBe("/search?format=reel");
    expect(m.discover.mock.calls[0][0].get("limit")).toBe("3");
  });
  it("keeps absent exact matches honest and explicitly labels relaxed broader filters", async () => {
    const result = await askAssistant({ message: "Korean comedy reels under 2 minutes" });
    expect(result.exact).toEqual({ total: 0, items: [] });
    expect(result.broader.items.map((item) => item.video.id)).toEqual(["one-table-for-two"]);
    expect(result.reply).toContain("relax content inspiration and genre");
    expect(result.broader.label).toContain("filters relaxed");
    expect(result.broader.items.every((item) => item.video.duration < 120)).toBe(true);
    expect((await askAssistant({ message: "private" })).exact.total).toBe(0);
  });
  it("does not search for ambiguous conversation or reveal a missing/private reference", async () => {
    for (const input of [
      { message: "hello" },
      { message: "more like this" },
      { message: "more like this", referenceVideoId: "unreviewed-demo" },
      { message: "more like this", referenceVideoId: "missing" },
    ]) {
      const result = await askAssistant(input);
      expect(result.clarification).toBe(true);
      expect(result.exact.items).toEqual([]);
      expect(result.broader.items).toEqual([]);
      expect(JSON.stringify(result)).not.toContain("Private processing example");
    }
    expect(m.discover).not.toHaveBeenCalled();
  });
  it("derives similarity only from a public record and excludes it from counts/cards", async () => {
    const result = await askAssistant({
      message: "more like this",
      referenceVideoId: "last-greenhouse",
    });
    expect(result.query.genres).toEqual(["nature", "sci-fi"]);
    expect(result.query.formats).toEqual(["movie"]);
    expect(result.exact.total).toBe(1);
    expect(result.exact.items.map((item) => item.video.id)).toEqual(["tides-of-tomorrow"]);
    expect(result.query.regions).toEqual([]);
    expect(result.reply).toContain("shared genre and format");
    expect(result.reply).not.toContain("shared genre, content inspiration");
    expect(m.find).toHaveBeenCalledExactlyOnceWith("last-greenhouse");
  });
  it("preserves live mode and fails without any demo fallback", async () => {
    m.discover.mockResolvedValueOnce({
      mode: "live",
      query: {},
      exact: { total: 0, items: [] },
      broader: { label: "", items: [] },
    });
    expect((await askAssistant({ message: "comedy" })).mode).toBe("live");
    m.discover.mockRejectedValueOnce(new Error("Published catalog unavailable"));
    await expect(askAssistant({ message: "comedy" })).rejects.toThrow("unavailable");
    expect(m.discover).toHaveBeenCalledTimes(2);
  });
});
