import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogVideo } from "../src/features/discovery/catalog";
import { demoCatalog } from "./fixtures/catalog";
import {
  parseDiscoveryParams,
  searchCatalog,
  serializeDiscoveryQuery,
} from "../src/features/discovery/query";
const m = vi.hoisted(() => ({ discover: vi.fn(), find: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/discovery/service", () => ({ discover: m.discover, findPublicVideo: m.find }));
import { loadReelViewer } from "../src/features/reels/service";
import {
  appendReelPage,
  createReelQuery,
  MAX_REEL_QUEUE,
  parseReelCatalogPage,
  reelCatalogParams,
  reelVideoSchema,
  reelViewerSchema,
} from "../src/features/reels/schema";

let catalog: CatalogVideo[];
function reel(index: number, patch: Partial<CatalogVideo> = {}): CatalogVideo {
  return {
    ...demoCatalog[0],
    id: `reel-${String(index).padStart(3, "0")}`,
    duration: 90,
    ...patch,
  };
}
function page(params: URLSearchParams, items = catalog) {
  const query = parseDiscoveryParams(params);
  return {
    mode: "demo" as const,
    query,
    ...searchCatalog(items, query, {
      catalogVersion: "reels-test",
      limit: Number(params.get("limit") ?? 20),
      cursor: params.get("cursor") ?? undefined,
    }),
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  catalog = structuredClone(demoCatalog);
  m.find.mockImplementation(
    async (id: string) =>
      catalog.find((item) => item.id === id && item.status === "published") ?? null,
  );
  m.discover.mockImplementation(async (params: URLSearchParams) => page(params));
});

describe("bounded exact public reel viewer bootstrap", () => {
  it("returns serializable public reel data without private examples or movies", async () => {
    const result = (await loadReelViewer("one-table-for-two", new URLSearchParams()))!;
    expect(result).toMatchObject({
      mode: "demo",
      initialId: "one-table-for-two",
      nextCursor: null,
      backHref: "/reels?format=reel",
    });
    expect(result.items.map((item) => item.id)).toEqual([
      "one-table-for-two",
      "somewhere-after-midnight",
    ]);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(m.find).toHaveBeenCalledExactlyOnceWith("one-table-for-two");
    expect(m.discover).toHaveBeenCalledTimes(1);
    expect(m.discover.mock.calls[0][0].get("limit")).toBe("20");
  });
  it.each(["missing", "unreviewed-demo", "last-greenhouse", "../private"])(
    "denies absent, private, nonreel or unsafe targets: %s",
    async (id) => {
      expect(await loadReelViewer(id, new URLSearchParams())).toBeNull();
      expect(m.discover).not.toHaveBeenCalled();
    },
  );
  it("forces reel-only format after conversational parsing and preserves other exact filters", async () => {
    const result = (await loadReelViewer(
      "somewhere-after-midnight",
      new URLSearchParams(
        "q=Korean+romance+movies+under+3+minutes&format=movie&language=korean&tag=rain",
      ),
    ))!;
    expect(result.query).toMatchObject({
      formats: ["reel"],
      regions: ["korean"],
      genres: ["romance"],
      languages: ["korean"],
      hashtags: ["rain"],
      maxDurationSeconds: 179,
    });
    expect(result.items).toHaveLength(1);
    expect(parseDiscoveryParams(new URLSearchParams(result.backHref.split("?")[1]))).toEqual(
      result.query,
    );
    expect(result.backHref).not.toContain("movie");
  });
  it.each([
    "genre=horror",
    "region=filipino",
    "language=tagalog",
    "keyword=unmatched",
    "tag=missing",
    "maxDuration=100",
  ])("never admits a broader-only source for %s", async (filter) => {
    expect(
      await loadReelViewer("somewhere-after-midnight", new URLSearchParams(filter)),
    ).toBeNull();
    expect(m.discover).not.toHaveBeenCalled();
  });
  it("looks up an outside-page permalink once and prepends it without scanning or losing pagination", async () => {
    catalog = Array.from({ length: 45 }, (_, index) => reel(index));
    const result = (await loadReelViewer("reel-044", new URLSearchParams()))!;
    expect(result.items).toHaveLength(21);
    expect(result.items.map((item) => item.id)).toEqual([
      "reel-044",
      ...catalog.slice(0, 20).map((item) => item.id),
    ]);
    expect(result.initialId).toBe("reel-044");
    expect(result.nextCursor).not.toBeNull();
    expect(m.find).toHaveBeenCalledTimes(1);
    expect(m.discover).toHaveBeenCalledTimes(1);
  });
  it("preserves the selected browse cursor and return page size while requesting only20 viewer results", async () => {
    catalog = Array.from({ length: 45 }, (_, index) => reel(index));
    const first = page(reelCatalogParams(createReelQuery(new URLSearchParams())));
    const params = new URLSearchParams({
      format: "reel",
      cursor: first.exact.nextCursor!,
      limit: "7",
    });
    const result = (await loadReelViewer("reel-025", params))!;
    expect(result.items.map((item) => item.id)).toEqual(
      catalog.slice(20, 40).map((item) => item.id),
    );
    expect(result.items.filter((item) => item.id === "reel-025")).toHaveLength(1);
    const back = new URLSearchParams(result.backHref.split("?")[1]);
    expect(back.get("cursor")).toBe(first.exact.nextCursor);
    expect(back.get("limit")).toBe("7");
    expect(m.discover.mock.calls[0][0].get("cursor")).toBe(first.exact.nextCursor);
    expect(m.discover.mock.calls[0][0].get("limit")).toBe("20");
  });
  it("rejects stale filter-bound cursors instead of silently restarting or relaxing filters", async () => {
    catalog = Array.from({ length: 25 }, (_, index) => reel(index));
    const cursor = page(reelCatalogParams(createReelQuery(new URLSearchParams()))).exact
      .nextCursor!;
    await expect(
      loadReelViewer("reel-000", new URLSearchParams({ genre: "romance", cursor })),
    ).rejects.toThrow(/cursor/);
  });
  it.each([
    "unknown=1",
    "genre=not-a-genre",
    "limit=100",
    "cursor=",
    "q=a&q=b",
    "minDuration=150&maxDuration=1",
  ])("rejects malformed source filters %s", async (value) => {
    await expect(loadReelViewer("one-table-for-two", new URLSearchParams(value))).rejects.toThrow();
    expect(m.find).not.toHaveBeenCalled();
    expect(m.discover).not.toHaveBeenCalled();
  });
  it("rejects mismatched source identity and private/executable source additions", async () => {
    for (const patch of [
      { id: "another-public-id" },
      { status: "pending_review" },
      { providerId: "private" },
      { artwork: "https://tracking.example/pixel.png" },
    ]) {
      m.find.mockResolvedValueOnce({ ...demoCatalog[0], ...patch });
      expect(await loadReelViewer("somewhere-after-midnight", new URLSearchParams())).toBeNull();
    }
    expect(m.discover).not.toHaveBeenCalled();
  });
  it("rejects changed API filters and never returns private broader records", async () => {
    const params = new URLSearchParams("genre=romance");
    const valid = page(reelCatalogParams(createReelQuery(params)));
    m.discover.mockResolvedValueOnce({
      ...valid,
      query: createReelQuery(new URLSearchParams("genre=comedy")),
    });
    await expect(loadReelViewer("somewhere-after-midnight", params)).rejects.toThrow();
    m.discover.mockResolvedValueOnce({
      ...valid,
      broader: {
        label: "Broader",
        items: [{ providerId: "private", title: "Secret", status: "pending_review" }],
      },
    });
    const result = await loadReelViewer("somewhere-after-midnight", params);
    expect(JSON.stringify(result)).not.toContain("private");
    expect(JSON.stringify(result)).not.toContain("Secret");
  });
});

describe("strict client-safe reel data and explicit page append", () => {
  it("validates published-only safe metadata, local artwork and reel-only format", () => {
    for (const patch of [
      { status: "pending_review" },
      { format: "movie" },
      { duration: 181 },
      { duration: 0 },
      { providerId: "private" },
      { id: "../unsafe" },
      { artwork: "//tracking.example/pixel.png" },
      { artwork: "/artwork/../private.png" },
      { artwork: "/artwork/payload.svg" },
    ])
      expect(reelVideoSchema.safeParse({ ...demoCatalog[0], ...patch }).success).toBe(false);
    expect(reelVideoSchema.safeParse({ ...demoCatalog[0], artwork: "" }).success).toBe(true);
  });
  it("rejects executable/noncanonical return links, absent selections and extra private fields", async () => {
    const current = (await loadReelViewer("one-table-for-two", new URLSearchParams()))!;
    for (const patch of [
      { backHref: "javascript:alert(1)" },
      { backHref: "//evil.example/reels" },
      { backHref: "/reels?format=movie" },
      { backHref: "/reels?format=reel#private" },
      { backHref: "/reels?unknown=1&format=reel" },
      { initialId: "missing" },
      { privateNotes: "secret" },
      { items: [current.items[0], current.items[0]] },
    ])
      expect(reelViewerSchema.safeParse({ ...current, ...patch }).success).toBe(false);
  });
  it("bounds bootstrap data at21 rather than accepting a whole retained queue", async () => {
    catalog = Array.from({ length: 25 }, (_, index) => reel(index));
    const current = (await loadReelViewer("reel-024", new URLSearchParams()))!;
    expect(current.items).toHaveLength(21);
    expect(
      reelViewerSchema.safeParse({ ...current, items: catalog.slice(0, 22), initialId: "reel-000" })
        .success,
    ).toBe(false);
  });
  it("requires live UUID identities and refuses demo records in live mode", () => {
    const query = createReelQuery(new URLSearchParams());
    const id = "83000000-0000-4000-8000-000000000001",
      creator = "83000000-0000-4000-8000-000000000002";
    const valid = {
      mode: "live",
      query,
      exact: {
        items: [{ ...demoCatalog[0], id, creator, demo: false, artwork: "" }],
        total: 1,
        nextCursor: null,
      },
      broader: { label: "Broader", items: [] },
    };
    expect(parseReelCatalogPage(valid, query, "live").exact.items[0].id).toBe(id);
    for (const item of [
      { ...valid.exact.items[0], id: "demo-slug" },
      { ...valid.exact.items[0], demo: true },
      { ...valid.exact.items[0], creator: "private alias" },
    ])
      expect(() =>
        parseReelCatalogPage({ ...valid, exact: { ...valid.exact, items: [item] } }, query, "live"),
      ).toThrow();
    expect(() => parseReelCatalogPage(valid, query, "demo")).toThrow();
  });
  it("appends exactly one validated page, keeps existing identities stable and deduplicates a prepended source", async () => {
    catalog = Array.from({ length: 45 }, (_, index) => reel(index));
    const current = (await loadReelViewer("reel-044", new URLSearchParams()))!;
    const second = page(reelCatalogParams(current.query, current.nextCursor));
    const appended = appendReelPage(current, second, current.nextCursor!);
    expect(appended.viewer.items).toHaveLength(41);
    expect(appended.viewer.initialId).toBe("reel-044");
    const third = page(reelCatalogParams(current.query, appended.viewer.nextCursor));
    third.exact.items[4] = {
      ...third.exact.items[4],
      title: "Changed metadata must not replace selected item",
    };
    const complete = appendReelPage(
      appended.viewer,
      third,
      appended.viewer.nextCursor!,
      appended.consumedCursors,
    );
    expect(complete.viewer.items).toHaveLength(45);
    expect(complete.viewer.items[0].title).toBe(current.items[0].title);
    expect(complete.viewer.nextCursor).toBeNull();
    expect(complete.consumedCursors).toHaveLength(2);
    expect(complete.viewer.backHref).toBe(current.backHref);
  });
  it("stops repeated/empty cursors and refuses stale or replayed responses", async () => {
    catalog = Array.from({ length: 25 }, (_, index) => reel(index));
    const current = (await loadReelViewer("reel-000", new URLSearchParams()))!;
    const response = page(reelCatalogParams(current.query, current.nextCursor));
    expect(
      appendReelPage(
        current,
        { ...response, exact: { ...response.exact, nextCursor: current.nextCursor } },
        current.nextCursor!,
      ).viewer.nextCursor,
    ).toBeNull();
    expect(
      appendReelPage(
        current,
        { ...response, exact: { items: [], total: 25, nextCursor: "another-cursor" } },
        current.nextCursor!,
      ).viewer.nextCursor,
    ).toBeNull();
    expect(() => appendReelPage(current, response, "stale")).toThrow(/stale/);
    expect(() =>
      appendReelPage(current, response, current.nextCursor!, [current.nextCursor!]),
    ).toThrow(/consumed/);
  });
  it("stops a cursor cycle back to the original browse page before requesting it again", async () => {
    catalog = Array.from({ length: 65 }, (_, index) => reel(index));
    const initial = page(reelCatalogParams(createReelQuery(new URLSearchParams()))).exact
      .nextCursor!;
    const current = (await loadReelViewer("reel-025", new URLSearchParams({ cursor: initial })))!;
    const response = page(reelCatalogParams(current.query, current.nextCursor));
    expect(
      appendReelPage(
        current,
        { ...response, exact: { ...response.exact, nextCursor: initial } },
        current.nextCursor!,
      ).viewer.nextCursor,
    ).toBeNull();
    m.discover.mockResolvedValueOnce({
      ...response,
      exact: { ...response.exact, nextCursor: initial },
    });
    const boot = (await loadReelViewer("reel-025", new URLSearchParams({ cursor: initial })))!;
    expect(boot.nextCursor).toBeNull();
  });
  it("rejects filter/mode changes, nonmatching exact records, overlong pages and duplicate API IDs", async () => {
    catalog = Array.from({ length: 25 }, (_, index) => reel(index));
    const current = (await loadReelViewer("reel-000", new URLSearchParams()))!;
    const response = page(reelCatalogParams(current.query, current.nextCursor));
    for (const invalid of [
      { ...response, mode: "live" },
      { ...response, query: createReelQuery(new URLSearchParams("genre=romance")) },
      { ...response, exact: { ...response.exact, items: [reel(99, { format: "movie" })] } },
      {
        ...response,
        exact: { ...response.exact, items: [response.exact.items[0], response.exact.items[0]] },
      },
      {
        ...response,
        exact: {
          ...response.exact,
          items: Array.from({ length: 21 }, (_, index) => reel(100 + index)),
        },
      },
      { ...response, exact: { ...response.exact, total: 0 } },
    ])
      expect(() => appendReelPage(current, invalid, current.nextCursor!)).toThrow();
    expect(serializeDiscoveryQuery(current.query).toString()).toBe("format=reel");
  });
  it("bounds retained queue growth and asks to return to browse instead of scanning", async () => {
    catalog = Array.from({ length: MAX_REEL_QUEUE + 20 }, (_, index) => reel(index));
    let current = (await loadReelViewer("reel-220", new URLSearchParams()))!;
    let consumed: string[] = [];
    while (current.items.length < MAX_REEL_QUEUE) {
      const result = appendReelPage(
        current,
        page(reelCatalogParams(current.query, current.nextCursor)),
        current.nextCursor!,
        consumed,
      );
      current = result.viewer;
      consumed = result.consumedCursors;
    }
    expect(current.items).toHaveLength(MAX_REEL_QUEUE);
    expect(() =>
      appendReelPage(
        current,
        page(reelCatalogParams(current.query, current.nextCursor)),
        current.nextCursor!,
        consumed,
      ),
    ).toThrow(/queue limit/);
    expect(m.discover).toHaveBeenCalledTimes(1);
  });
});
