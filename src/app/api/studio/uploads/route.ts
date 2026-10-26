import { z } from "zod";
import { requireAccount, apiResponse, databaseFailure } from "@/features/auth/guard";
import { readBoundedJson } from "@/features/auth/request";
import { getSupabaseConfig } from "@/lib/env";
const uploadInput = z
  .object({
    versionId: z.uuid(),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,100}$/),
    fileSize: z.number().int().min(1).max(50_000_000),
  })
  .strict();
const reservationSchema = z.object({
  reservation_id: z.uuid(),
  version_id: z.uuid(),
  bucket: z.literal("aiverse-videos"),
  object_path: z.string().max(200),
  expires_at: z.iso.datetime({ offset: true }),
  max_duration_seconds: z.number().int().positive().max(1200),
  file_size: z.number().int().positive().max(50_000_000),
});
export async function POST(request: Request) {
  const auth = await requireAccount(request);
  if (auth.response) return auth.response;
  if (request.headers.get("x-aiverse-account") !== auth.user.id)
    return apiResponse({ error: "Your signed-in account changed. Refresh the studio." }, 409);
  if (!auth.user.email_confirmed_at)
    return apiResponse({ error: "Verify your email before uploading." }, 403);
  const parsed = uploadInput.safeParse(await readBoundedJson(request, 1024).catch(() => null));
  if (!parsed.success)
    return apiResponse(
      { error: "Choose an MP4 file no larger than 50 MB for this revision." },
      400,
    );
  const config = getSupabaseConfig();
  if (!config) return apiResponse({ error: "Upload storage is unavailable." }, 503);
  const reserved = await auth.client.rpc("reserve_storage_video_upload", {
    version_id: parsed.data.versionId,
    idempotency_key: parsed.data.idempotencyKey,
    file_size: parsed.data.fileSize,
  });
  if (reserved.error) return databaseFailure(reserved.error);
  const value = reservationSchema.safeParse(reserved.data);
  if (!value.success)
    return apiResponse(
      { error: "The upload reservation could not be confirmed. Refresh status." },
      409,
    );
  const r = value.data,
    path = `${auth.user.id}/${parsed.data.versionId}/${r.reservation_id}.mp4`,
    deadline = Date.parse(r.expires_at);
  if (
    r.version_id !== parsed.data.versionId ||
    r.object_path !== path ||
    r.file_size !== parsed.data.fileSize ||
    deadline <= Date.now() ||
    deadline > Date.now() + 3600000
  )
    return apiResponse(
      { error: "This upload reservation is no longer available. Save a new revision." },
      409,
    );
  const signed = await auth.client.storage
    .from(r.bucket)
    .createSignedUploadUrl(path, { upsert: false });
  if (signed.error || !signed.data?.signedUrl)
    return apiResponse(
      { error: "The upload could not be authorized. Check status before continuing." },
      409,
    );
  const url = new URL(signed.data.signedUrl);
  if (
    url.origin !== new URL(config.url).origin ||
    url.pathname !== `/storage/v1/object/upload/sign/aiverse-videos/${path}` ||
    !url.searchParams.get("token") ||
    url.username ||
    url.password ||
    url.hash
  )
    return apiResponse({ error: "The upload authorization could not be verified." }, 503);
  return apiResponse(
    {
      accountId: auth.user.id,
      versionId: parsed.data.versionId,
      reservationId: r.reservation_id,
      uploadUrl: url.toString(),
      expiresAt: r.expires_at,
      fileSize: r.file_size,
      protocol: "supabase",
    },
    201,
  );
}
export async function GET(request: Request) {
  const auth = await requireAccount();
  if (auth.response) return auth.response;
  if (request.headers.get("x-aiverse-account") !== auth.user.id)
    return apiResponse({ error: "Your signed-in account changed. Refresh the studio." }, 409);
  if (!auth.user.email_confirmed_at)
    return apiResponse({ error: "Verify your email before uploading." }, 403);
  const versionId = new URL(request.url).searchParams.get("versionId");
  if (!z.uuid().safeParse(versionId).success)
    return apiResponse({ error: "Invalid revision." }, 400);
  const result = await auth.client
    .from("storage_media_uploads")
    .select("reservation_id,version_id,state")
    .eq("version_id", versionId)
    .eq("owner_id", auth.user.id)
    .maybeSingle();
  if (result.error) return databaseFailure(result.error);
  const status = result.data?.state;
  if (result.data && !["reserved", "pending_review", "failed"].includes(status))
    return apiResponse({ error: "Upload status is unavailable." }, 503);
  return apiResponse({
    accountId: auth.user.id,
    versionId,
    reservationId: result.data?.reservation_id ?? null,
    status: status ?? "none",
  });
}
