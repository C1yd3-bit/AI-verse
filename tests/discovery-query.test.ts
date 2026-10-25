import { describe, expect, it } from "vitest";
import type { CatalogVideo } from "../src/features/discovery/catalog";
import { demoCatalog } from "./fixtures/catalog";
import {
  discoveryQuerySchema,
  parseDiscoveryParams,
  parseNaturalLanguageQuery,
  searchCatalog,
  serializeDiscoveryQuery,
} from "../src/features/discovery/query";
import {
  initialRecommendationConfig,
  rankRecommendations,
  type RecommendationContext,
  type RecommendationWatchSignal,
} from "../src/features/discovery/recommendations";

const empty = () => discoveryQuerySchema.parse({});
const page = (query = empty(), catalog = demoCatalog) =>
  searchCatalog(catalog, query, { catalogVersion: "fixture-v1" });
const sample = (id: string, values: Partial<CatalogVideo> = {}): CatalogVideo => ({
  ...demoCatalog[0],
  id,
  creator: `creator-${id}`,
  ...values,
});

describe("deterministic discovery query", () => {
  it("extracts region, genre, format and a strict duration without inventing a match", () => {
    const query = parseNaturalLanguageQuery("Korean romantic reels under 2 minutes");
    expect(query).toEqual({
      ...empty(),
      regions: ["korean"],
      genres: ["romance"],
      formats: ["reel"],
      maxDurationSeconds: 119,
    });
    expect(page(query).exact.items).toEqual([]);
    expect(page(query).broader.items.every((video) => video.duration < 120)).toBe(true);
    expect(
      page(parseNaturalLanguageQuery("Korean romantic reels under 3 minutes")).exact.items.map(
        (video) => video.id,
      ),
    ).toEqual(["somewhere-after-midnight"]);
  });
  it("keeps content inspiration separate from explicitly spoken language", () => {
    expect(parseNaturalLanguageQuery("Filipino horror in Tagalog")).toEqual({
      ...empty(),
      regions: ["filipino"],
      genres: ["horror"],
      languages: ["tagalog"],
    });
    expect(parseNaturalLanguageQuery("romance in Korean")).toEqual({
      ...empty(),
      genres: ["romance"],
      languages: ["korean"],
    });
    expect(page(parseNaturalLanguageQuery("Filipino horror in Tagalog")).exact.items).toEqual([]);
  });
  it("keeps descriptive keywords and unicode text as grounded catalog searches", () => {
    expect(
      page(parseNaturalLanguageQuery("show me a cat cooking spaghetti please")).exact.items.map(
        (video) => video.id,
      ),
    ).toEqual(["one-table-for-two"]);
    expect(
      page(parseNaturalLanguageQuery("#cooking #rain")).exact.items.map((video) => video.id),
    ).toEqual(["one-table-for-two", "somewhere-after-midnight"]);
    expect(
      page(parseNaturalLanguageQuery("달빛"), [
        sample("moon", { title: "달빛 아래" }),
      ]).exact.items.map((video) => video.id),
    ).toEqual(["moon"]);
    expect(page(parseNaturalLanguageQuery("' OR true --")).exact.items).toEqual([]);
  });
  it("uses OR within selections and AND across dimensions", () => {
    const query = discoveryQuerySchema.parse({
      regions: ["korean", "global"],
      genres: ["romance", "wholesome"],
      languages: ["english", "korean"],
      formats: ["reel"],
    });
    expect(query.regions).toEqual([]);
    expect(page(query).exact.items.map((video) => video.id)).toEqual([
      "one-table-for-two",
      "somewhere-after-midnight",
    ]);
    const restricted = { ...query, regions: ["korean"] };
    expect(page(restricted).exact.items.map((video) => video.id)).toEqual([
      "somewhere-after-midnight",
    ]);
  });
  it("round-trips canonical multi-selection URLs including literal alias keywords", () => {
    const query = discoveryQuerySchema.parse({
      keywords: ["romantic", "Korean"],
      genres: ["romance", "comedy"],
      regions: ["korean", "filipino"],
      languages: ["tagalog", "korean"],
      formats: ["reel", "movie"],
      hashtags: ["rain", "cooking"],
      minDurationSeconds: 30,
      maxDurationSeconds: 120,
    });
    expect(parseDiscoveryParams(serializeDiscoveryQuery(query))).toEqual(query);
    expect(
      parseDiscoveryParams(new URLSearchParams("region=any&region=korean&format=reels")).regions,
    ).toEqual([]);
    expect(parseNaturalLanguageQuery("any Korean romance").regions).toEqual([]);
  });
  it("rejects unknown structured values and bounded malformed input", () => {
    for (const value of [
      "region=atlantis",
      "genre=unknown",
      "language=elvish",
      "format=podcast",
      "unknown=one",
      "minDuration=1e2",
      "q=one&q=two",
      "minDuration=120&maxDuration=30",
      "limit=0",
      "limit=51",
      "limit=NaN",
      "cursor=",
    ]) {
      expect(() => parseDiscoveryParams(new URLSearchParams(value))).toThrow();
    }
    expect(() => parseNaturalLanguageQuery("x".repeat(501))).toThrow();
    expect(() => parseNaturalLanguageQuery("under 0 seconds")).toThrow();
    expect(() => parseNaturalLanguageQuery("over 3 minutes under 2 minutes")).toThrow();
    expect(() =>
      page(
        discoveryQuerySchema.parse({
          hashtags: Array.from({ length: 11 }, (_, index) => `tag${index}`),
        }),
      ),
    ).toThrow();
  });
  it("keeps broader candidates labeled, published, disjoint and within hard restrictions", () => {
    const result = page(parseNaturalLanguageQuery("Korean comedy reels under 2 minutes"));
    expect(result.exact.items).toEqual([]);
    expect(result.broader.label).toContain("filters relaxed");
    expect(result.broader.items.map((video) => video.id)).toEqual(["one-table-for-two"]);
    expect(page(parseNaturalLanguageQuery("private")).broader.items).toEqual([]);
    expect(page().exact.items.some((video) => video.status !== "published")).toBe(false);
  });
  it("uses stable keyset pages, rejects altered snapshots/filters and deduplicates IDs", () => {
    const catalog = [
      sample("c"),
      sample("a"),
      sample("b"),
      sample("a"),
      sample("hidden", { status: "pending_review" }),
    ];
    const first = searchCatalog(catalog, empty(), { catalogVersion: "v1", limit: 2 });
    expect(first.exact.items.map((video) => video.id)).toEqual(["a", "b"]);
    const second = searchCatalog(catalog, empty(), {
      catalogVersion: "v1",
      limit: 2,
      cursor: first.exact.nextCursor!,
    });
    expect(second.exact.items.map((video) => video.id)).toEqual(["c"]);
    expect(second.exact.nextCursor).toBeNull();
    expect(() =>
      searchCatalog(catalog, empty(), { catalogVersion: "v2", cursor: first.exact.nextCursor! }),
    ).toThrow();
    expect(() =>
      searchCatalog(catalog, parseNaturalLanguageQuery("romance"), {
        catalogVersion: "v1",
        cursor: first.exact.nextCursor!,
      }),
    ).toThrow();
    expect(() =>
      searchCatalog(catalog, empty(), { catalogVersion: "v1", cursor: "%00" }),
    ).toThrow();
    expect(() => searchCatalog(catalog, empty(), { catalogVersion: "v1", limit: 51 })).toThrow();
  });
  it("distinguishes inclusive and strict fractional duration bounds", () => {
    expect(parseNaturalLanguageQuery("at most 2 minutes").maxDurationSeconds).toBe(120);
    expect(parseNaturalLanguageQuery("under 1.5 minutes").maxDurationSeconds).toBe(89);
    expect(parseNaturalLanguageQuery("over 1.5 minutes").minDurationSeconds).toBe(91);
    expect(parseNaturalLanguageQuery("at least 90.5 seconds").minDurationSeconds).toBe(91);
  });
});

const context = (overrides: Partial<RecommendationContext> = {}): RecommendationContext => ({
  interests: empty(),
  now: 2000000000000,
  seed: "viewer-session",
  ...overrides,
});
const watch = (overrides: Partial<RecommendationWatchSignal> = {}): RecommendationWatchSignal => ({
  eventId: "event",
  videoId: "source",
  durationSeconds: 134,
  watchedSeconds: 134,
  userInitiated: true,
  autoplay: false,
  suspectedBot: false,
  ...overrides,
});
describe("transparent bounded recommendations", () => {
  it("removes blocked, not-interested, seen and private content before any allocation", () => {
    const catalog = [
      sample("blocked", { creator: "blocked-creator" }),
      sample("negative"),
      sample("seen"),
      sample("private", { status: "pending_review" }),
      sample("eligible"),
    ];
    const result = rankRecommendations(
      catalog,
      context({
        blockedCreatorIds: ["blocked-creator"],
        notInterestedVideoIds: ["negative"],
        seenVideoIds: ["seen"],
      }),
    );
    expect(result.items.map((item) => item.video.id)).toEqual(["eligible"]);
    expect(result.note).toContain("hypotheses");
  });
  it("learns from explicit completion history even after watched clips are marked seen", () => {
    const catalog = [sample("source"), sample("romance"), sample("comedy", { genres: ["comedy"] })];
    const result = rankRecommendations(
      catalog,
      context({ seenVideoIds: ["source"], watches: [watch()] }),
      { ...initialRecommendationConfig, explorationFraction: 0 },
    );
    expect(result.items[0].video.id).toBe("romance");
    expect(result.items[0].factors.completion).toBe(1);
    expect(result.items[1].factors.completion).toBe(0);
  });
  it("ignores autoplay, bot, implicit and spoofed-duration completion signals", () => {
    const catalog = [sample("source"), sample("target")];
    const result = rankRecommendations(
      catalog,
      context({
        watches: [
          watch({ eventId: "auto", autoplay: true }),
          watch({ eventId: "bot", suspectedBot: true }),
          watch({ eventId: "implicit", userInitiated: false }),
          watch({ eventId: "spoof", durationSeconds: 1 }),
        ],
      }),
    );
    expect(result.items.every((item) => item.factors.completion === 0)).toBe(true);
  });
  it("bounds repeated events per source and never inflates scores with view counts", () => {
    const catalog = [sample("source"), sample("target")];
    const single = rankRecommendations(
      catalog,
      context({ watches: [watch({ watchedSeconds: 67 })] }),
    );
    const repeated = rankRecommendations(
      catalog,
      context({
        watches: Array.from({ length: 100 }, (_, index) =>
          watch({ eventId: `repeat-${index}`, watchedSeconds: 67 }),
        ),
      }),
    );
    expect(repeated.items.map((item) => item.factors.completion)).toEqual(
      single.items.map((item) => item.factors.completion),
    );
    expect(repeated.items.every((item) => item.score >= 0 && item.score <= 1)).toBe(true);
  });
  it("allocates deterministic exploration and enforces creator diversity without repeats", () => {
    const catalog = Array.from({ length: 20 }, (_, index) =>
      sample(`video-${String(index).padStart(2, "0")}`, {
        creator: `creator-${Math.floor(index / 3)}`,
      }),
    );
    const config = { ...initialRecommendationConfig, limit: 10, maxPerCreator: 2 };
    const first = rankRecommendations(catalog, context(), config);
    expect(first).toEqual(rankRecommendations([...catalog].reverse(), context(), config));
    expect(first.items).toHaveLength(10);
    expect(new Set(first.items.map((item) => item.video.id)).size).toBe(10);
    expect(first.actualExplorationFraction).toBe(0.2);
    expect(
      [...new Set(first.items.map((item) => item.video.creator))].every(
        (creator) => first.items.filter((item) => item.video.creator === creator).length <= 2,
      ),
    ).toBe(true);
  });
  it("exposes bounded factors and validates configuration and signals", () => {
    const catalog = [sample("future"), sample("recent")];
    const result = rankRecommendations(
      catalog,
      context({
        interests: discoveryQuerySchema.parse({ genres: ["romance"] }),
        likedVideoIds: ["recent"],
        followedCreatorIds: ["creator-recent"],
        publishedAt: { recent: 2000000000000, future: 2000000000001 },
      }),
    );
    expect(result.items[0].video.id).toBe("recent");
    expect(result.items[0].factors).toEqual({
      interest: 1,
      completion: 0,
      engagement: 1,
      freshness: 1,
    });
    expect(result.items.find((item) => item.video.id === "future")!.factors.freshness).toBe(0);
    expect(() =>
      rankRecommendations(catalog, context(), {
        ...initialRecommendationConfig,
        explorationFraction: 1,
      }),
    ).toThrow();
    expect(() =>
      rankRecommendations(catalog, context(), {
        ...initialRecommendationConfig,
        weights: { interest: 0, completion: 0, engagement: 0, freshness: 0 },
      }),
    ).toThrow();
    expect(() =>
      rankRecommendations(catalog, context({ watches: [watch({ watchedSeconds: -1 })] })),
    ).toThrow();
  });
});
