import { z } from "zod";

/** Static demo assets or an exact same-origin approved-version image endpoint. */
export function isCatalogArtworkPath(value: string) {
  if (value === "") return true;
  if (value.startsWith("/api/"))
    return value.startsWith("/api/artwork/") && z.uuid().safeParse(value.slice(13)).success;
  if (/^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:png|jpe?g|webp|avif)$/i.test(value)) return true;
  return false;
}
