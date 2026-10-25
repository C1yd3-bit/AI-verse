import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { apiResponse } from "@/features/auth/guard";
import { isWorker } from "@/features/media/worker-auth";
import { createStreamProvider, getStreamConfig } from "@/features/media/stream";
import { createHash } from "node:crypto";
export async function POST(request: Request) {
  if (!isWorker(request)) return apiResponse({ error: "Worker authorization required" }, 401);
  const admin = createSupabaseAdminClient();
  const config = getStreamConfig();
  if (!admin || !config) return apiResponse({ error: "Media services are not configured" }, 503);
  const provider = createStreamProvider(config);
  const pending = await admin.rpc("claim_media_processing", { batch_size: 10 });
  if (pending.error || !Array.isArray(pending.data))
    return apiResponse({ error: "Processing queue unavailable" }, 502);
  let reconciled = 0;
  for (const row of pending.data) {
    try {
      const asset = await provider.getAsset(row.provider_uid);
      if (!asset.requireSignedURLs || (!asset.readyToStream && asset.state !== "error")) continue;
      const state = asset.state === "error" ? "failed" : "ready";
      const duration = Math.ceil(asset.durationSeconds ?? 0);
      const eventKey = createHash("sha256")
        .update(`poll:${asset.assetId}:${state}:${duration}`)
        .digest("hex");
      const result = await admin.rpc("reconcile_video_provider", {
        event_key: eventKey,
        provider_uid: asset.assetId,
        provider_state: state,
        actual_duration_seconds: duration,
        operation_key: null,
      });
      if (!result.error) reconciled++;
    } catch {
      /* Keep processing record pending for the next worker tick. */
    }
  }
  const expired = await admin.rpc("expire_upload_reservations");
  if (expired.error) return apiResponse({ error: "Reservation cleanup failed" }, 502);
  const result = await admin.rpc("claim_media_deletions", { batch_size: 10 });
  if (result.error || !Array.isArray(result.data))
    return apiResponse({ error: "Deletion queue unavailable" }, 502);
  let completed = 0;
  for (const job of result.data) {
    let succeeded = false;
    try {
      await provider.deleteAsset(job.provider_uid);
      succeeded = true;
    } catch {
      /* Persist a bounded safe failure for retry. */
    }
    const finished = await admin.rpc("finish_media_deletion", {
      job_id: job.job_id,
      lease_token: job.lease_token,
      succeeded,
      error_message: succeeded ? null : "Provider deletion failed",
    });
    if (!finished.error && succeeded) completed += 1;
  }
  const days = Number(process.env.AIVERSE_RETENTION_DAYS);
  let retention = "disabled";
  if (Number.isInteger(days) && days >= 30 && days <= 365) {
    const purged = await admin.rpc("purge_operational_events", {
      cutoff: new Date(Date.now() - days * 86400000).toISOString(),
    });
    retention = purged.error ? "retry required" : "applied";
  }
  return apiResponse({
    claimed: result.data.length,
    completed,
    expired: expired.data,
    reconciled,
    retention,
  });
}
