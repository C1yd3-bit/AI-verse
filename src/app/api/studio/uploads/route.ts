import { requireAccount, apiResponse, databaseFailure } from "@/features/auth/guard";
import { readBoundedJson } from "@/features/auth/request";
import { uploadInput } from "@/features/media/schema";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getStreamConfig, createStreamProvider } from "@/features/media/stream";

export async function POST(request: Request) {
  const auth = await requireAccount(request);
  if (auth.response) return auth.response;
  // Comparison only: verified cookie identity and SQL authorization remain authoritative.
  const expectedAccount = request.headers.get("x-aiverse-account");
  if (expectedAccount !== null && expectedAccount !== auth.user.id)
    return apiResponse({ error: "Your signed-in account changed. Refresh the studio." }, 409);
  const parsed = uploadInput.safeParse(await readBoundedJson(request).catch(() => null));
  if (!parsed.success)
    return apiResponse(
      {
        error:
          "A valid version, stable upload request key and file size up to 500 MB are required.",
      },
      400,
    );
  const config = getStreamConfig();
  const admin = createSupabaseAdminClient();
  if (!config || !admin || process.env.AIVERSE_ENABLE_STREAM_UPLOADS !== "true")
    return apiResponse({ error: "Video uploads are not enabled. Your draft is saved." }, 503);
  const reserved = await auth.client.rpc("reserve_video_upload", {
    version_id: parsed.data.versionId,
    idempotency_key: parsed.data.idempotencyKey,
  });
  if (reserved.error) return databaseFailure(reserved.error);
  const reservation = reserved.data;
  const claim = await admin.rpc("begin_upload_grant", {
    reservation_id: reservation.reservation_id,
  });
  if (claim.error) return databaseFailure(claim.error);
  if (!claim.data?.lease)
    return apiResponse(
      {
        error:
          "This upload request already started. Check its status before trying another upload.",
      },
      409,
    );
  const provider = createStreamProvider(config);
  let assetId: string | undefined;
  try {
    const grant = await provider.createDirectUpload({
      creatorId: auth.user.id,
      operationKey: claim.data.operation_key,
      maxDurationSeconds: reservation.max_duration_seconds,
      expiresAt: new Date(reservation.expires_at),
      fileSize: parsed.data.fileSize,
    });
    assetId = grant.assetId;
    const bound = await admin.rpc("bind_video_provider", {
      reservation_id: reservation.reservation_id,
      provider_uid: assetId,
    });
    if (bound.error) throw new Error("Binding failed");
    if (bound.data?.usable !== true)
      return apiResponse(
        { error: "This film changed or is no longer eligible for upload. Refresh its status." },
        409,
      );
    return apiResponse(
      {
        accountId: auth.user.id,
        versionId: parsed.data.versionId,
        uploadUrl: grant.uploadUrl,
        expiresAt: grant.expiresAt,
        reservationId: reservation.reservation_id,
        protocol: grant.protocol,
        fileSize: parsed.data.fileSize,
      },
      201,
    );
  } catch {
    // Unknown provider outcomes never automatically issue a second grant. A webhook
    // can recover the reservation using the immutable provider operation key.
    await admin.rpc("mark_upload_grant_failure", {
      reservation_id: reservation.reservation_id,
      known_no_asset: false,
      error_message: "Provider operation needs reconciliation",
    });
    if (assetId) {
      try {
        await provider.deleteAsset(assetId);
      } catch {
        /* Durable operation remains uncertain for operator recovery. */
      }
    }
    return apiResponse(
      { error: "The upload could not be authorized. Check its status before retrying." },
      502,
    );
  }
}
