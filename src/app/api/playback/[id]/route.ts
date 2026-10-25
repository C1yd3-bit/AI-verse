import { z } from "zod";
import { apiResponse } from "@/features/auth/guard";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createStreamProvider, getStreamConfig } from "@/features/media/stream";
import { openPlaybackTracking } from "@/features/playback/service";
import { MAX_MOVIE_SECONDS, MAX_PLAYBACK_TTL_SECONDS } from "@/features/media/policy";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const version = new URL(request.url).searchParams.get("version");
  if (!z.uuid().safeParse(id).success || (version && !z.uuid().safeParse(version).success))
    return apiResponse({ error: "Film not found" }, 404);
  const config = getStreamConfig();
  const admin = createSupabaseAdminClient();
  if (!admin || !config) return apiResponse({ error: "Playback is not configured" }, 503);
  const client = await createSupabaseServerClient();
  const identity = client ? await client.auth.getUser() : null;
  const userId = identity && !identity.error ? (identity.data.user?.id ?? null) : null;
  const result = await admin.rpc("playback_entitlement", {
    video_id: id,
    viewer_id: userId,
    requested_version_id: version,
  });
  if (result.error || !result.data?.provider_uid)
    return apiResponse({ error: "Film is not available" }, 404);
  const initialDuration = z
    .number()
    .int()
    .min(1)
    .max(MAX_MOVIE_SECONDS)
    .safeParse(result.data.duration_seconds);
  if (!initialDuration.success) return apiResponse({ error: "Film is not available" }, 404);
  try {
    const seconds = Math.min(
      MAX_PLAYBACK_TTL_SECONDS,
      Math.max(60, initialDuration.data + 60),
      Math.floor((Date.parse(result.data.expires_at) - Date.now()) / 1000),
    );
    if (!Number.isFinite(seconds) || seconds < 5)
      return apiResponse({ error: "Please request playback again" }, 409);
    const grant = await createStreamProvider(config).createPlaybackToken(
      result.data.provider_uid,
      seconds,
      Math.floor(Date.parse(result.data.expires_at) / 1000),
    );
    // Provider calls may race a review, revision, role change or takedown.
    const current = await admin.rpc("playback_entitlement", {
      video_id: id,
      viewer_id: userId,
      requested_version_id: version,
    });
    if (
      current.error ||
      current.data?.provider_uid !== result.data.provider_uid ||
      current.data?.version_id !== result.data.version_id ||
      current.data?.duration_seconds !== initialDuration.data ||
      grant.expiresAt * 1000 > Date.parse(result.data.expires_at)
    )
      return apiResponse({ error: "Film is no longer available. Refresh before playing." }, 404);
    const publicVersionId = z.uuid().safeParse(current.data.version_id);
    const duration = z
      .number()
      .int()
      .min(1)
      .max(MAX_MOVIE_SECONDS)
      .safeParse(current.data.duration_seconds);
    const tracking =
      !version &&
      userId &&
      identity?.data.user?.email_confirmed_at &&
      current.data.public_playback === true &&
      publicVersionId.success &&
      duration.success
        ? await openPlaybackTracking(admin, userId, id, publicVersionId.data, grant.expiresAt)
        : null;
    return apiResponse({
      iframeUrl: `https://iframe.videodelivery.net/${grant.token}`,
      expiresAt: grant.expiresAt,
      versionId: publicVersionId.success ? publicVersionId.data : null,
      durationSeconds: duration.success ? duration.data : null,
      tracking,
    });
  } catch {
    return apiResponse({ error: "Playback is temporarily unavailable" }, 502);
  }
}
