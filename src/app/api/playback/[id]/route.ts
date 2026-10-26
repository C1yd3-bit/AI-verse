import { z } from "zod";
import { apiResponse } from "@/features/auth/guard";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/env";
import { playbackTrackingSchema } from "@/features/playback/schema";
const grantSchema = z
  .object({
    videoUrl: z.url().max(8300),
    expiresAt: z.number().int().positive(),
    versionId: z.uuid(),
    durationSeconds: z.number().int().min(1).max(1200),
    tracking: playbackTrackingSchema.nullable(),
  })
  .strict();
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params,
    version = new URL(request.url).searchParams.get("version");
  if (!z.uuid().safeParse(id).success || (version && !z.uuid().safeParse(version).success))
    return apiResponse({ error: "Film not found." }, 404);
  const config = getSupabaseConfig(),
    client = await createSupabaseServerClient();
  if (!config || !client) return apiResponse({ error: "Playback is not configured." }, 503);
  const identity = await client.auth.getUser();
  if (identity.error && identity.error.name !== "AuthSessionMissingError")
    return apiResponse({ error: "Your session could not be verified. Sign in again." }, 401);
  const user = !identity.error ? identity.data.user : null;
  const result = await client.functions.invoke("media-storage", {
    body: { action: "playback", videoId: id, versionId: version },
    ...(user ? {} : { headers: { Authorization: "" } }),
  });
  if (result.error) {
    const status = result.error.context instanceof Response ? result.error.context.status : 503;
    return apiResponse(
      { error: "Film is not available for playback." },
      [401, 403, 404, 409].includes(status) ? status : 503,
    );
  }
  const parsed = grantSchema.safeParse(result.data);
  if (!parsed.success) return apiResponse({ error: "Playback could not be verified." }, 503);
  const grant = parsed.data,
    url = new URL(grant.videoUrl),
    remaining = grant.expiresAt * 1000 - Date.now();
  if (
    url.origin !== new URL(config.url).origin ||
    !/^\/storage\/v1\/object\/sign\/aiverse-videos\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.mp4$/.test(
      url.pathname,
    ) ||
    !url.searchParams.get("token") ||
    url.username ||
    url.password ||
    url.hash ||
    remaining <= 0 ||
    remaining > Math.max(60, grant.durationSeconds + 60) * 1000 ||
    (version && grant.versionId !== version) ||
    (grant.tracking &&
      (grant.tracking.accountId !== user?.id || grant.tracking.versionId !== grant.versionId))
  )
    return apiResponse({ error: "Playback could not be verified." }, 503);
  return apiResponse({
    ...grant,
    tracking: !version && user?.email_confirmed_at ? grant.tracking : null,
  });
}
