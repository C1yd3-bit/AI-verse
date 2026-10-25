import { z } from "zod";
import { MAX_REEL_SECONDS } from "@/features/media/policy";
import { isCatalogArtworkPath } from "@/features/discovery/artwork";
import { genreSlugs, regionSlugs } from "@/features/preferences/schema";
import {
  discoveryQuerySchema,
  languageSlugs,
  parseDiscoveryParams,
  searchCatalog,
  serializeDiscoveryQuery,
  type DiscoveryQuery,
} from "@/features/discovery/query";

export const REEL_PAGE_SIZE = 20;
export const MAX_REEL_QUEUE = 201;
export const reelIdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/);
const cursorSchema = z.string().min(1).max(16384);
export const reelQuerySchema = discoveryQuerySchema.refine(
  (query) => query.formats.length === 1 && query.formats[0] === "reel",
  "Reel discovery must retain its reel-only format",
);

/** Parse conversational input before forcing format, so q=movies cannot widen
 * the dedicated Reels collection through the normal OR-within-format rule. */
export function createReelQuery(params: URLSearchParams): DiscoveryQuery {
  return reelQuerySchema.parse({ ...parseDiscoveryParams(params), formats: ["reel"] });
}

export function reelCatalogParams(query: DiscoveryQuery, cursor?: string | null) {
  const params = serializeDiscoveryQuery(reelQuerySchema.parse(query));
  if (cursor) params.set("cursor", cursorSchema.parse(cursor));
  params.set("limit", String(REEL_PAGE_SIZE));
  return params;
}

export function reelBackHref(query: DiscoveryQuery, source = new URLSearchParams()) {
  // Validate paging parameters as well as filters before retaining them.
  parseDiscoveryParams(source);
  const params = serializeDiscoveryQuery(reelQuerySchema.parse(query));
  const cursor = source.get("cursor");
  if (cursor) params.set("cursor", cursorSchema.parse(cursor));
  if (source.has("limit")) params.set("limit", source.get("limit")!);
  return `/reels?${params}`;
}

export const reelVideoSchema = z
  .object({
    id: reelIdSchema,
    title: z.string().min(1).max(500),
    description: z.string().max(10000),
    creator: z.string().min(1).max(200),
    format: z.literal("reel"),
    duration: z.number().int().min(1).max(MAX_REEL_SECONDS),
    genres: z.array(z.enum(genreSlugs)).max(12),
    regions: z.array(z.enum(regionSlugs)).max(12),
    languages: z.array(z.enum(languageSlugs)).max(languageSlugs.length),
    tags: z.array(z.string().min(1).max(80)).max(32),
    artwork: z.string().max(300).refine(isCatalogArtworkPath, "Expected a local artwork path"),
    status: z.literal("published"),
    demo: z.boolean().optional(),
    publishedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
export type ReelVideo = z.infer<typeof reelVideoSchema>;

export function isExactReel(video: ReelVideo, query: DiscoveryQuery) {
  return (
    searchCatalog([video], reelQuerySchema.parse(query), {
      catalogVersion: "reel-validation",
      limit: 1,
      broaderLimit: 0,
    }).exact.total === 1
  );
}

function validateItems(
  mode: "demo" | "live",
  query: DiscoveryQuery,
  items: ReelVideo[],
  ctx: z.RefinementCtx,
) {
  if (new Set(items.map((item) => item.id)).size !== items.length)
    ctx.addIssue({ code: "custom", message: "Reel IDs must be unique" });
  for (const [index, item] of items.entries()) {
    if (!isExactReel(item, query))
      ctx.addIssue({
        code: "custom",
        path: ["items", index],
        message: "Only exact reel matches may enter the viewer",
      });
    if (
      mode === "live" &&
      (item.demo === true ||
        !z.uuid().safeParse(item.id).success ||
        !z.uuid().safeParse(item.creator).success)
    )
      ctx.addIssue({
        code: "custom",
        path: ["items", index],
        message: "Live reels require real public catalog identities",
      });
    if (mode === "demo" && item.demo === false)
      ctx.addIssue({
        code: "custom",
        path: ["items", index],
        message: "Demo pages cannot carry live records",
      });
  }
}

export const reelCatalogPageSchema = z
  .object({
    mode: z.enum(["demo", "live"]),
    query: reelQuerySchema,
    exact: z
      .object({
        items: z.array(reelVideoSchema).max(REEL_PAGE_SIZE),
        total: z.number().int().nonnegative(),
        nextCursor: cursorSchema.nullable(),
      })
      .strict(),
    // Broader suggestions are deliberately never admitted or returned. Existing
    // catalog responses include them, even when there are zero exact matches.
    broader: z.object({ label: z.string().max(500), items: z.array(z.unknown()).max(10) }).strict(),
  })
  .strict()
  .superRefine((page, ctx) => {
    validateItems(page.mode, page.query, page.exact.items, ctx);
    if (page.exact.total < page.exact.items.length)
      ctx.addIssue({ code: "custom", message: "Exact total must include the returned page" });
  });

export const reelQueueSchema = z
  .object({
    mode: z.enum(["demo", "live"]),
    query: reelQuerySchema,
    items: z.array(reelVideoSchema).min(1).max(MAX_REEL_QUEUE),
    initialId: reelIdSchema,
    nextCursor: cursorSchema.nullable(),
    backHref: z.string().max(65536),
  })
  .strict()
  .superRefine((viewer, ctx) => {
    validateItems(viewer.mode, viewer.query, viewer.items, ctx);
    if (!viewer.items.some((item) => item.id === viewer.initialId))
      ctx.addIssue({
        code: "custom",
        path: ["initialId"],
        message: "Selected reel must be in this queue",
      });
    try {
      if (!viewer.backHref.startsWith("/reels?") || viewer.backHref.includes("#"))
        throw new Error("Invalid local return URL");
      const params = new URLSearchParams(viewer.backHref.slice("/reels?".length));
      const query = parseDiscoveryParams(params);
      if (
        serializeDiscoveryQuery(query).toString() !==
          serializeDiscoveryQuery(viewer.query).toString() ||
        reelBackHref(query, params) !== viewer.backHref
      )
        throw new Error("Return URL must preserve canonical reel filters");
    } catch {
      ctx.addIssue({
        code: "custom",
        path: ["backHref"],
        message: "Expected a canonical local Reels return URL",
      });
    }
  });
/** Bootstrap has one20-record page plus, at most, a separately looked-up source. */
export const reelViewerSchema = reelQueueSchema.refine(
  (viewer) => viewer.items.length <= REEL_PAGE_SIZE + 1,
  "The initial reel viewer may contain at most21 records",
);
export type ReelViewerData = z.infer<typeof reelQueueSchema>;

export function parseReelCatalogPage(
  raw: unknown,
  expectedQuery: DiscoveryQuery,
  expectedMode: "demo" | "live",
) {
  const page = reelCatalogPageSchema.parse(raw);
  if (
    page.mode !== expectedMode ||
    serializeDiscoveryQuery(page.query).toString() !==
      serializeDiscoveryQuery(reelQuerySchema.parse(expectedQuery)).toString()
  )
    throw new Error("Catalog context changed. Return to Reels and restart browsing.");
  return page;
}

/** One explicit load-more response. Never scan/fetch adjacent pages here. */
export function appendReelPage(
  current: ReelViewerData,
  raw: unknown,
  requestedCursor: string,
  consumedCursors: readonly string[] = [],
) {
  const viewer = reelQueueSchema.parse(current);
  const consumed = z.array(cursorSchema).max(20).parse(consumedCursors);
  if (requestedCursor !== viewer.nextCursor || consumed.includes(requestedCursor))
    throw new Error("Reel page is stale or was already consumed.");
  const page = parseReelCatalogPage(raw, viewer.query, viewer.mode);
  const known = new Set(viewer.items.map((item) => item.id));
  const additions = page.exact.items.filter((item) => !known.has(item.id));
  if (viewer.items.length + additions.length > MAX_REEL_QUEUE)
    throw new Error("Reel queue limit reached. Return to Reels to continue browsing.");
  const nextConsumed = [...consumed, requestedCursor];
  const initialCursor = new URLSearchParams(viewer.backHref.split("?")[1]).get("cursor");
  const nextCursor =
    !additions.length ||
    (page.exact.nextCursor !== null &&
      (nextConsumed.includes(page.exact.nextCursor) || page.exact.nextCursor === initialCursor))
      ? null
      : page.exact.nextCursor;
  return {
    viewer: reelQueueSchema.parse({
      ...viewer,
      items: [...viewer.items, ...additions],
      nextCursor,
    }),
    consumedCursors: nextConsumed,
  };
}
