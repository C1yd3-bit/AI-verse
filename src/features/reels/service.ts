import "server-only";
import { discover, findPublicVideo } from "@/features/discovery/service";
import {
  createReelQuery,
  isExactReel,
  parseReelCatalogPage,
  reelBackHref,
  reelCatalogParams,
  reelIdSchema,
  reelVideoSchema,
  reelViewerSchema,
  type ReelViewerData,
} from "./schema";

/** One public target lookup plus one bounded matching page. A permalink outside
 * that page is prepended once; no broadened suggestions or catalog scans. */
export async function loadReelViewer(
  id: string,
  params: URLSearchParams,
): Promise<ReelViewerData | null> {
  if (!reelIdSchema.safeParse(id).success) return null;
  const query = createReelQuery(params);
  const target = reelVideoSchema.safeParse(await findPublicVideo(id));
  if (!target.success || target.data.id !== id || !isExactReel(target.data, query)) return null;
  const raw = await discover(reelCatalogParams(query, params.get("cursor")));
  const page = parseReelCatalogPage(raw, query, raw.mode);
  const items = page.exact.items.some((item) => item.id === id)
    ? page.exact.items
    : [target.data, ...page.exact.items];
  return reelViewerSchema.parse({
    mode: page.mode,
    query,
    items,
    initialId: id,
    nextCursor:
      !page.exact.items.length || page.exact.nextCursor === params.get("cursor")
        ? null
        : page.exact.nextCursor,
    backHref: reelBackHref(query, params),
  });
}
