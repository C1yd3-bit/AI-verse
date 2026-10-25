import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { playbackProgressInput, playbackProgressResult, playbackTrackingSchema } from "./schema";

export async function openPlaybackTracking(
  client: SupabaseClient,
  accountId: string,
  videoId: string,
  versionId: string,
  expiresAt: number,
) {
  const result = await Promise.resolve(
    client.rpc("open_playback_session", {
      viewer_id: accountId,
      video_id: videoId,
      version_id: versionId,
      expires_at: new Date(expiresAt * 1000).toISOString(),
    }),
  ).catch(() => ({ data: null, error: { code: "session_unavailable" } }));
  if (result.error || result.data === null) return null;
  const tracking = playbackTrackingSchema.safeParse(result.data);
  return tracking.success &&
    tracking.data.accountId === accountId &&
    tracking.data.versionId === versionId
    ? tracking.data
    : null;
}

export async function recordPlaybackProgress(
  client: SupabaseClient,
  videoId: string,
  input: z.infer<typeof playbackProgressInput>,
) {
  const result = await client.rpc("record_playback_progress", {
    video_id: videoId,
    session_key: input.sessionKey,
    watched_seconds: input.watchedSeconds,
  });
  if (result.error) return { data: null, error: result.error };
  const progress = playbackProgressResult.safeParse(result.data);
  return progress.success && progress.data.watchedSeconds === input.watchedSeconds
    ? { data: progress.data, error: null }
    : { data: null, error: { code: "invalid_projection" } };
}
