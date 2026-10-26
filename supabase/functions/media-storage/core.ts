import type { SupabaseClient } from "@supabase/supabase-js";
import { inspectMp4, MAX_STORAGE_VIDEO_BYTES } from "./mp4.ts";

type Options = {
  url: string;
  anonKey: string;
  serviceKey: string;
  publicUrl?: string;
  createClient: (key: string, authorization?: string) => SupabaseClient;
  fetcher?: typeof fetch;
  now?: () => number;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const bucket = "aiverse-videos";
const objectPath = (owner: string, version: string, reservation: string) =>
  `${owner}/${version}/${reservation}.mp4`;
const reply = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });

async function boundedBytes(response: Response, maximum: number): Promise<Uint8Array> {
  if (!response.ok || !response.body) throw new Error("The uploaded file is not available yet.");
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) !== maximum)) {
    await response.body.cancel();
    throw new Error("The uploaded file size does not match this revision.");
  }
  const bytes = new Uint8Array(maximum);
  const reader = response.body.getReader();
  let at = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      if (at + part.value.length > maximum) throw new Error("The uploaded file is too large.");
      bytes.set(part.value, at);
      at += part.value.length;
    }
    if (at !== maximum) throw new Error("The uploaded file transfer is incomplete.");
    return bytes;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async function input(request: Request): Promise<Record<string, unknown>> {
  if (!request.body || !request.headers.get("content-type")?.startsWith("application/json"))
    throw new Error("Invalid request.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > 2048) throw new Error("Invalid request.");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Invalid request.");
  return parsed as Record<string, unknown>;
}

/** Service credentials stay inside the Edge runtime. Private calls always verify the user's JWT. */
export function createMediaStorageHandler(options: Options) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  async function cleanup() {
    const admin = options.createClient(options.serviceKey);
    const claimed = await admin.rpc("claim_storage_deletions", { batch_size: 3 });
    if (claimed.error || !Array.isArray(claimed.data)) return;
    for (const job of claimed.data.slice(0, 3)) {
      if (
        !uuid.test(job.job_id) ||
        !uuid.test(job.lease_token) ||
        job.bucket !== bucket ||
        typeof job.object_path !== "string" ||
        !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.mp4$/.test(job.object_path)
      )
        continue;
      const removed = await admin.storage
        .from(bucket)
        .remove([job.object_path])
        .catch(() => ({ error: true }));
      await admin.rpc("finish_media_deletion", {
        job_id: job.job_id,
        lease_token: job.lease_token,
        succeeded: !removed.error,
        error_message: removed.error ? "Storage deletion will be retried" : null,
      });
    }
  }
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return reply({ error: "Method not allowed." }, 405);
    let data: Record<string, unknown>;
    try {
      data = await input(request);
    } catch {
      return reply({ error: "Invalid request." }, 400);
    }
    if (data.action !== "complete" && data.action !== "playback")
      return reply({ error: "Invalid action." }, 400);
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.match(/^Bearer (\S+)$/i)?.[1];
    if (authorization.trim() && !token) return reply({ error: "Sign in again." }, 401);
    // Empty Authorization is an explicit anonymous public-playback request. A bad user token never downgrades to guest.
    const caller = options.createClient(options.anonKey, token ? authorization : undefined);
    let userId: string | null = null;
    if (token && token !== options.anonKey) {
      const identity = await caller.auth.getUser(token).catch(() => null);
      if (!identity || identity.error || !identity.data.user)
        return reply({ error: "Sign in again." }, 401);
      userId = identity.data.user.id;
      if (data.action === "complete" && !identity.data.user.email_confirmed_at)
        return reply({ error: "Verify your email before uploading." }, 403);
    }
    if (data.action === "complete") {
      if (!userId) return reply({ error: "Sign in to complete this upload." }, 401);
      if (
        Object.keys(data).some((key) => !["action", "reservationId", "versionId"].includes(key)) ||
        typeof data.reservationId !== "string" ||
        !uuid.test(data.reservationId) ||
        typeof data.versionId !== "string" ||
        !uuid.test(data.versionId)
      )
        return reply({ error: "Invalid upload." }, 400);
      // Opportunistic bounded cleanup uses only sealed service-side leases; there is no public cleanup action.
      await cleanup().catch(() => undefined);
      const row = await caller
        .from("storage_media_uploads")
        .select("reservation_id,version_id,owner_id,bucket,object_path,expected_bytes,state")
        .eq("reservation_id", data.reservationId)
        .eq("version_id", data.versionId)
        .eq("owner_id", userId)
        .maybeSingle();
      const upload = row.data;
      if (
        row.error ||
        !upload ||
        upload.bucket !== bucket ||
        upload.object_path !== objectPath(userId, data.versionId, data.reservationId) ||
        !Number.isSafeInteger(upload.expected_bytes) ||
        upload.expected_bytes < 1 ||
        upload.expected_bytes > MAX_STORAGE_VIDEO_BYTES
      )
        return reply({ error: "Upload not found." }, 404);
      if (upload.state === "failed")
        return reply({ error: "This upload failed. Save a new revision." }, 409);
      let invalidFile = false;
      try {
        const asset = new URL(
          `/storage/v1/object/authenticated/${bucket}/${upload.object_path}`,
          options.url,
        );
        const response = await fetcher(asset, {
          headers: { apikey: options.serviceKey, Authorization: `Bearer ${options.serviceKey}` },
          redirect: "error",
          signal: AbortSignal.timeout(60000),
        });
        const bytes = await boundedBytes(response, upload.expected_bytes);
        let inspected;
        try {
          inspected = inspectMp4(bytes);
        } catch (error) {
          invalidFile = true;
          throw error;
        }
        const admin = options.createClient(options.serviceKey);
        const complete = await admin.rpc("complete_storage_video_upload", {
          reservation_id: data.reservationId,
          actual_bytes: inspected.bytes,
          duration_seconds: inspected.durationSeconds,
        });
        if (
          complete.error ||
          complete.data?.version_id !== data.versionId ||
          complete.data?.state !== "pending_review"
        )
          return reply(
            { error: "This revision changed or cannot be completed. Refresh the studio." },
            409,
          );
        return reply({
          accountId: userId,
          versionId: data.versionId,
          reservationId: data.reservationId,
          status: "pending_review",
        });
      } catch (error) {
        if (invalidFile) {
          const admin = options.createClient(options.serviceKey);
          await Promise.resolve(admin.rpc("fail_storage_video_upload", {
              reservation_id: data.reservationId,
              reason: "invalid_file",
            })).catch(() => undefined);
          await cleanup().catch(() => undefined);
        }
        const message =
          error instanceof Error &&
          /^(Choose an MP4|Invalid MP4|An MP4|Use a standard|This MP4|Export a complete|Movies must|Unsupported MP4|A valid H\.264|External MP4|One H\.264|The uploaded file)/.test(
            error.message,
          )
            ? error.message
            : "The uploaded file could not be verified yet. Check the transfer and try completion again.";
        return reply({ error: message }, 422);
      }
    }
    if (
      Object.keys(data).some((key) => !["action", "videoId", "versionId"].includes(key)) ||
      typeof data.videoId !== "string" ||
      !uuid.test(data.videoId) ||
      (data.versionId !== undefined &&
        data.versionId !== null &&
        (typeof data.versionId !== "string" || !uuid.test(data.versionId)))
    )
      return reply({ error: "Film not found." }, 404);
    const params = { video_id: data.videoId, requested_version_id: data.versionId ?? null };
    const entitled = await caller.rpc("storage_playback_entitlement", params);
    const entitlement = entitled.data;
    if (
      entitled.error ||
      !entitlement ||
      entitlement.bucket !== bucket ||
      typeof entitlement.object_path !== "string" ||
      !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.mp4$/.test(entitlement.object_path) ||
      !uuid.test(entitlement.version_id) ||
      !Number.isInteger(entitlement.duration_seconds) ||
      entitlement.duration_seconds < 1 ||
      entitlement.duration_seconds > 1200
    )
      return reply({ error: "Film is not available." }, 404);
    const deadline = Math.floor(Date.parse(entitlement.expires_at) / 1000);
    const seconds = Math.min(
      1260,
      Math.max(60, entitlement.duration_seconds + 60),
      deadline - Math.floor(now() / 1000) - 5,
    );
    if (!Number.isFinite(seconds) || seconds < 5)
      return reply({ error: "Request playback again." }, 409);
    const admin = options.createClient(options.serviceKey);
    const signed = await admin.storage
      .from(bucket)
      .createSignedUrl(entitlement.object_path, seconds);
    if (signed.error || !signed.data?.signedUrl)
      return reply({ error: "Playback is temporarily unavailable." }, 503);
    const current = await caller.rpc("storage_playback_entitlement", params);
    if (
      current.error ||
      !current.data ||
      current.data.object_path !== entitlement.object_path ||
      current.data.version_id !== entitlement.version_id ||
      current.data.duration_seconds !== entitlement.duration_seconds ||
      Date.parse(current.data.expires_at) < deadline * 1000
    )
      return reply({ error: "Film is no longer available." }, 404);
    // Preserve the duration-bound window so native Range requests can finish a full film.
    const signedUrl = new URL(signed.data.signedUrl);
    let tokenDeadline: number;
    try {
      const payload = signedUrl.searchParams.get("token")!.split(".")[1];
      tokenDeadline = JSON.parse(atob(payload.replaceAll("-", "+").replaceAll("_", "/"))).exp;
      if (!Number.isInteger(tokenDeadline) || tokenDeadline > deadline)
        throw new Error("Expired capability.");
    } catch {
      return reply({ error: "Playback access could not be bounded safely." }, 503);
    }
    const expiresAt = Math.min(deadline, tokenDeadline);
    if (expiresAt <= Math.floor(now() / 1000))
      return reply({ error: "Request playback again." }, 409);
    let tracking = null;
    if (!data.versionId && userId && current.data.public_playback === true) {
      const session = await admin.rpc("open_playback_session", {
        viewer_id: userId,
        video_id: data.videoId,
        version_id: entitlement.version_id,
        expires_at: new Date(expiresAt * 1000).toISOString(),
      });
      if (
        !session.error &&
        session.data?.accountId === userId &&
        session.data?.versionId === entitlement.version_id
      )
        tracking = session.data;
    }
    return reply({
      videoUrl: options.publicUrl
        ? new URL(signedUrl.pathname + signedUrl.search, options.publicUrl).toString()
        : signed.data.signedUrl,
      expiresAt,
      versionId: entitlement.version_id,
      durationSeconds: entitlement.duration_seconds,
      tracking,
    });
  };
}
