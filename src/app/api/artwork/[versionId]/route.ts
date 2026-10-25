import { createClient } from "@supabase/supabase-js";
import { apiResponse } from "@/features/auth/guard";
import { artworkBytes } from "@/features/media/artwork";
import { artworkVersionId } from "@/features/media/artwork-schema";
import { getSupabaseConfig } from "@/lib/env";

export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ versionId: string }> }) {
  const version = artworkVersionId.safeParse((await context.params).versionId);
  if (!version.success) return apiResponse({ error: "Thumbnail unavailable." }, 404);
  const config = getSupabaseConfig();
  if (!config) return apiResponse({ error: "Thumbnail unavailable." }, 503);
  // A dedicated anonymous client deliberately ignores any signed-in user's private access.
  const client = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
  const result = await client.rpc("get_public_version_artwork", { version_id: version.data });
  if (result.error) return apiResponse({ error: "Thumbnail unavailable." }, 502);
  if (result.data === null) return apiResponse({ error: "Thumbnail unavailable." }, 404);
  const image = artworkBytes(result.data);
  if (!image) return apiResponse({ error: "Thumbnail unavailable." }, 502);
  return new Response(new Uint8Array(image), {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(image.length),
      // Recheck active revision/suspension on every request; no stale public image cache.
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
