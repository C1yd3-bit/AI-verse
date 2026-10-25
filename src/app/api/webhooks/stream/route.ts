import { z } from "zod";
import { apiResponse } from "@/features/auth/guard";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createStreamProvider, getStreamConfig } from "@/features/media/stream";
import { readAndVerifyStreamWebhook, StreamWebhookError } from "@/features/media/webhook";
export async function POST(request: Request) {
  const admin = createSupabaseAdminClient();
  const config = getStreamConfig();
  const secret = process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET;
  if (!admin || !config || !secret) return apiResponse({ error: "Webhook not configured" }, 503);
  try {
    const event = await readAndVerifyStreamWebhook(request, secret);
    // Re-read canonical provider state to handle out-of-order signed callbacks.
    const asset = await createStreamProvider(config).getAsset(event.asset.assetId);
    if (!asset.requireSignedURLs)
      return apiResponse({ error: "Private asset configuration required" }, 409);
    if (!asset.readyToStream && asset.state !== "error")
      return apiResponse({ ok: true, processing: true });
    const result = await admin.rpc("reconcile_video_provider", {
      event_key: event.eventId,
      provider_uid: asset.assetId,
      provider_state: asset.state === "error" ? "failed" : "ready",
      actual_duration_seconds: Math.ceil(asset.durationSeconds ?? 0),
      operation_key: z.uuid().safeParse(asset.operationKey).success ? asset.operationKey : null,
    });
    if (result.error) return apiResponse({ error: "Reconciliation needs retry" }, 502);
    return apiResponse({ ok: true });
  } catch (error) {
    if (error instanceof StreamWebhookError)
      return apiResponse({ error: "Webhook rejected" }, error.code === "invalid_body" ? 400 : 401);
    return apiResponse({ error: "Provider state unavailable; retry later" }, 502);
  }
}
