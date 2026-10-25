import { z } from "zod";
import { genreSlugs, regionSlugs } from "../preferences/schema";
import type { CatalogVideo } from "./catalog";

// Content language is independent of content-region inspiration. Keep this allowlist
// in sync with the server taxonomy when adding languages; never infer it from people.
export const languageSlugs = [
  "english",
  "korean",
  "mandarin",
  "cantonese",
  "tagalog",
  "japanese",
  "hindi",
  "thai",
  "vietnamese",
  "turkish",
  "spanish",
  "french",
  "german",
  "portuguese",
  "arabic",
  "indonesian",
  "silent",
] as const;
const canonical = (values: string[]) => [...new Set(values)].sort();
const token = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N}'_-]*$/u)
  .transform((value) => value.normalize("NFKC").toLocaleLowerCase("en-US"));
export const discoveryQuerySchema = z
  .object({
    keywords: z.array(token).max(32).default([]).transform(canonical),
    regions: z
      .array(z.enum(regionSlugs))
      .max(12)
      .default([])
      .transform((values) => (values.includes("global") ? [] : canonical(values))),
    genres: z.array(z.enum(genreSlugs)).max(12).default([]).transform(canonical),
    formats: z
      .array(z.enum(["reel", "movie"]))
      .max(2)
      .default([])
      .transform(canonical),
    languages: z
      .array(z.enum(languageSlugs))
      .max(languageSlugs.length)
      .default([])
      .transform(canonical),
    hashtags: z.array(token).max(10).default([]).transform(canonical),
    minDurationSeconds: z.number().int().min(0).max(10800).optional(),
    maxDurationSeconds: z.number().int().min(0).max(10800).optional(),
  })
  .strict()
  .refine(
    (query) =>
      query.minDurationSeconds === undefined ||
      query.maxDurationSeconds === undefined ||
      query.minDurationSeconds <= query.maxDurationSeconds,
    { message: "Minimum duration must not exceed maximum duration" },
  );
export type DiscoveryQuery = z.infer<typeof discoveryQuerySchema>;

const normalize = (text: string) => text.normalize("NFKC").toLocaleLowerCase("en-US");
const stopwords = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "for",
  "in",
  "with",
  "about",
  "show",
  "me",
  "find",
  "watch",
  "please",
  "videos",
  "video",
  "content",
]);
const genreAliases: Record<string, string> = {
  ...Object.fromEntries(genreSlugs.map((slug) => [slug, slug])),
  romantic: "romance",
  "science fiction": "sci-fi",
  scifi: "sci-fi",
  "sci fi": "sci-fi",
  funny: "comedy",
  historical: "history",
};
const formatAliases: Record<string, string> = {
  reel: "reel",
  reels: "reel",
  movie: "movie",
  movies: "movie",
  "short film": "movie",
  "short films": "movie",
};
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Bounded deterministic extraction. Unrecognized words remain keywords, never invented filters. */
export function parseNaturalLanguageQuery(input: string): DiscoveryQuery {
  const raw = z.string().max(500).parse(input);
  let rest = normalize(raw);
  const filters: Record<string, unknown> = {
    keywords: [],
    regions: [],
    genres: [],
    formats: [],
    languages: [],
    hashtags: [],
  };
  const add = (dimension: string, value: string) => (filters[dimension] as string[]).push(value);
  rest = rest.replace(/#([\p{L}\p{N}][\p{L}\p{N}_-]{0,79})/gu, (_, tag: string) => {
    add("hashtags", tag);
    return " ";
  });
  rest = rest.replace(
    /\b(under|less than|at most|up to|over|more than|at least)\s+(\d+(?:\.\d+)?)\s*(minutes?|mins?|seconds?|secs?)\b/gu,
    (_, comparator: string, amount: string, unit: string) => {
      const seconds = Number(amount) * (unit.startsWith("m") ? 60 : 1);
      const upper = ["under", "less than", "at most", "up to"].includes(comparator);
      const bound = upper
        ? ["under", "less than"].includes(comparator)
          ? Math.ceil(seconds) - 1
          : Math.floor(seconds)
        : ["over", "more than"].includes(comparator)
          ? Math.floor(seconds) + 1
          : Math.ceil(seconds);
      const key = upper ? "maxDurationSeconds" : "minDurationSeconds";
      filters[key] =
        filters[key] === undefined
          ? bound
          : upper
            ? Math.min(Number(filters[key]), bound)
            : Math.max(Number(filters[key]), bound);
      return " ";
    },
  );
  const languagePattern = languageSlugs.map(escapeRegex).join("|");
  rest = rest.replace(
    new RegExp(`\\b(?:in|spoken in|language)\\s+(${languagePattern})\\b`, "gu"),
    (_, language: string) => {
      add("languages", language);
      return " ";
    },
  );
  // English/Tagalog/etc. are unambiguous language words. Korean/Japanese/etc.
  // without an explicit language prefix retain their content-inspiration meaning.
  for (const language of languageSlugs.filter(
    (slug) => !(regionSlugs as readonly string[]).includes(slug),
  )) {
    rest = rest.replace(new RegExp(`\\b${escapeRegex(language)}\\b`, "gu"), () => {
      add("languages", language);
      return " ";
    });
  }
  const extract = (dimension: string, aliases: Record<string, string>) => {
    for (const alias of Object.keys(aliases).sort(
      (a, b) => b.length - a.length || a.localeCompare(b),
    )) {
      rest = rest.replace(
        new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegex(alias)}(?![\\p{L}\\p{N}_])`, "gu"),
        () => {
          add(dimension, aliases[alias]);
          return " ";
        },
      );
    }
  };
  extract(
    "regions",
    Object.fromEntries([...regionSlugs.map((slug) => [slug, slug]), ["any", "global"]]),
  );
  extract("genres", genreAliases);
  extract("formats", formatAliases);
  filters.keywords = (rest.match(/[\p{L}\p{N}][\p{L}\p{N}'_-]*/gu) ?? []).filter(
    (word) => !stopwords.has(word),
  );
  return discoveryQuerySchema.parse(filters);
}

/** Repeated singular parameters preserve OR-within / AND-across Fusion selections. */
export function parseDiscoveryParams(params: URLSearchParams): DiscoveryQuery {
  if (params.toString().length > 65536) throw new Error("Discovery URL is too long");
  const filterParams = new URLSearchParams(params);
  filterParams.delete("cursor");
  filterParams.delete("limit");
  if (filterParams.toString().length > 4096) throw new Error("Discovery filters are too long");
  const allowed = new Set([
    "q",
    "keyword",
    "region",
    "genre",
    "format",
    "language",
    "tag",
    "minDuration",
    "maxDuration",
    "cursor",
    "limit",
  ]);
  for (const key of params.keys())
    if (!allowed.has(key)) throw new Error(`Unknown discovery parameter: ${key}`);
  for (const key of ["q", "minDuration", "maxDuration", "cursor", "limit"]) {
    if (params.getAll(key).length > 1) throw new Error(`Repeated singleton parameter: ${key}`);
  }
  if (params.has("limit")) {
    const value = params.get("limit")!;
    if (!/^\d{1,2}$/.test(value) || Number(value) < 1 || Number(value) > 50)
      throw new Error("Discovery page limit must be 1–50");
  }
  if (params.has("cursor") && (!params.get("cursor") || params.get("cursor")!.length > 16384))
    throw new Error("Invalid discovery cursor length");
  const parsed = parseNaturalLanguageQuery(params.get("q") ?? "");
  const values = (key: string) => params.getAll(key).map(normalize);
  const explicitRegions = values("region").map((value) =>
    ["all", "any"].includes(value) ? "global" : value,
  );
  const explicitFormats = values("format")
    .filter((value) => value !== "all")
    .map((value) => formatAliases[value] ?? value);
  const numeric = (name: string) => {
    const value = params.get(name);
    if (value === null || value === "") return undefined;
    if (!/^\d{1,5}$/.test(value)) throw new Error(`Invalid ${name}`);
    return Number(value);
  };
  return discoveryQuerySchema.parse({
    ...parsed,
    keywords: [...parsed.keywords, ...values("keyword")],
    regions: [...parsed.regions, ...explicitRegions],
    genres: [...parsed.genres, ...values("genre").filter((value) => value !== "all")],
    formats: [...parsed.formats, ...explicitFormats],
    languages: [...parsed.languages, ...values("language").filter((value) => value !== "all")],
    hashtags: [...parsed.hashtags, ...values("tag").map((tag) => tag.replace(/^#/, ""))],
    minDurationSeconds: numeric("minDuration") ?? parsed.minDurationSeconds,
    maxDurationSeconds: numeric("maxDuration") ?? parsed.maxDurationSeconds,
  });
}

export function serializeDiscoveryQuery(input: DiscoveryQuery): URLSearchParams {
  const query = discoveryQuerySchema.parse(input);
  const params = new URLSearchParams();
  // Literal keyword parameters avoid reparsing an alias (e.g. a title named
  // Korean) into a filter during round-trip. q remains conversational input.
  for (const keyword of query.keywords) params.append("keyword", keyword);
  for (const [key, entries] of [
    ["region", query.regions],
    ["genre", query.genres],
    ["format", query.formats],
    ["language", query.languages],
    ["tag", query.hashtags],
  ] as const) {
    for (const value of entries) params.append(key, value);
  }
  if (query.minDurationSeconds !== undefined)
    params.set("minDuration", String(query.minDurationSeconds));
  if (query.maxDurationSeconds !== undefined)
    params.set("maxDuration", String(query.maxDurationSeconds));
  if (params.toString().length > 4096) throw new Error("Discovery filters are too long");
  return params;
}

function matches(video: CatalogVideo, query: DiscoveryQuery): boolean {
  if (video.status !== "published") return false;
  const any = (selected: string[], actual: string[]) =>
    !selected.length || selected.some((value) => actual.includes(value));
  const text = normalize(
    [
      video.title,
      video.description,
      ...video.tags,
      ...video.genres,
      ...video.regions,
      ...video.languages,
    ].join(" "),
  );
  return (
    any(query.regions, video.regions) &&
    any(query.genres, video.genres) &&
    any(query.formats, [video.format]) &&
    any(query.languages, video.languages) &&
    any(
      query.hashtags,
      video.tags.map((tag) => normalize(tag).replace(/^#/, "")),
    ) &&
    (query.minDurationSeconds === undefined || video.duration >= query.minDurationSeconds) &&
    (query.maxDurationSeconds === undefined || video.duration <= query.maxDurationSeconds) &&
    query.keywords.every((word) => text.includes(normalize(word)))
  );
}

const pageOptionsSchema = z
  .object({
    catalogVersion: z.string().min(1).max(100),
    cursor: z.string().max(16384).optional(),
    limit: z.number().int().min(1).max(50).default(20),
    broaderLimit: z.number().int().min(0).max(10).default(3),
  })
  .strict();
export type DiscoveryPageOptions = z.input<typeof pageOptionsSchema>;

/** Stable ID keyset order; version must identify a stable catalog snapshot. The
 * adapter must change catalogVersion on mutation, and reject stale cursors. */
export function searchCatalog(
  catalog: readonly CatalogVideo[],
  input: DiscoveryQuery,
  options: DiscoveryPageOptions,
) {
  const query = discoveryQuerySchema.parse(input);
  const { catalogVersion, cursor, limit, broaderLimit } = pageOptionsSchema.parse(options);
  const filterKey = serializeDiscoveryQuery(query).toString();
  let after = "";
  if (cursor) {
    let decoded: unknown;
    try {
      decoded = JSON.parse(decodeURIComponent(cursor));
    } catch {
      throw new Error("Invalid discovery cursor");
    }
    const page = z
      .object({
        v: z.literal(1),
        revision: z.string(),
        filters: z.string(),
        after: z.string().min(1).max(200),
      })
      .strict()
      .parse(decoded);
    if (page.revision !== catalogVersion || page.filters !== filterKey)
      throw new Error("Discovery cursor no longer matches this catalog or query");
    after = page.after;
  }
  const ids = new Set<string>();
  const published = catalog
    .filter((video) => {
      if (video.status !== "published" || ids.has(video.id)) return false;
      ids.add(video.id);
      return true;
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const exact = published.filter((video) => matches(video, query));
  const remaining = exact.filter((video) => video.id > after);
  const items = remaining.slice(0, limit);
  const last = items.at(-1);
  const nextCursor =
    remaining.length > limit && last
      ? encodeURIComponent(
          JSON.stringify({ v: 1, revision: catalogVersion, filters: filterKey, after: last.id }),
        )
      : null;
  const relaxed = { ...query, regions: [], genres: [] };
  const exactIds = new Set(exact.map((video) => video.id));
  return {
    exact: { items, total: exact.length, nextCursor },
    broader: {
      label: "Broader suggestions — content region and genre filters relaxed",
      items:
        (query.regions.length || query.genres.length) && exact.length < limit
          ? published
              .filter((video) => !exactIds.has(video.id) && matches(video, relaxed))
              .slice(0, broaderLimit)
          : [],
    },
  };
}
