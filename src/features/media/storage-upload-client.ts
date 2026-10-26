import { z } from "zod";

export const STORAGE_MAX_UPLOAD_BYTES = 50_000_000;
const identity = { accountId: z.uuid(), versionId: z.uuid(), reservationId: z.uuid() };
const grantSchema = z
  .object({
    ...identity,
    uploadUrl: z.url().max(8192),
    expiresAt: z.iso.datetime({ offset: true }),
    fileSize: z.number().int().positive().max(STORAGE_MAX_UPLOAD_BYTES),
    protocol: z.literal("supabase"),
  })
  .strict();

export function storageOrigin(configuredUrl: string) {
  const url = new URL(configuredUrl);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/"].includes(url.pathname) ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))
    )
  )
    throw new Error("Storage is not configured safely.");
  return url.origin;
}

export function safeStorageUrl(value: string, configuredUrl: string, path: string) {
  try {
    const origin = storageOrigin(configuredUrl);
    const url = new URL(value);
    const token = url.searchParams.get("token");
    return (
      url.origin === origin &&
      url.pathname === path &&
      !url.hash &&
      !url.username &&
      !url.password &&
      token !== null &&
      /^[A-Za-z0-9._~-]{1,6000}$/.test(token) &&
      value === `${origin}${path}?token=${token}`
    );
  } catch {
    return false;
  }
}

export function parseStorageGrant(
  value: unknown,
  accountId: string,
  versionId: string,
  configuredUrl: string,
  fileSize: number,
  now = Date.now(),
) {
  const grant = grantSchema.parse(value);
  const expiresAtMs = Date.parse(grant.expiresAt);
  const path = `/storage/v1/object/upload/sign/aiverse-videos/${accountId}/${versionId}/${grant.reservationId}.mp4`;
  if (
    grant.accountId !== accountId ||
    grant.versionId !== versionId ||
    grant.fileSize !== fileSize ||
    !safeStorageUrl(grant.uploadUrl, configuredUrl, path) ||
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs <= now ||
    expiresAtMs > now + 15 * 60 * 1000 + 5000
  )
    throw new Error("Upload authorization could not be verified.");
  return { ...grant, expiresAtMs };
}
export type StorageUploadGrant = ReturnType<typeof parseStorageGrant>;

export function validStorageFile(value: unknown): value is File {
  return (
    value instanceof File &&
    Number.isSafeInteger(value.size) &&
    value.size > 0 &&
    value.size <= STORAGE_MAX_UPLOAD_BYTES &&
    /\.mp4$/i.test(value.name) &&
    ["video/mp4", ""].includes(value.type)
  );
}

export async function readStorageResponse(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (!response.body || (length !== null && (!/^\d+$/.test(length) || Number(length) > 16384))) {
    await response.body?.cancel();
    throw new Error("Storage response is unavailable.");
  }
  const reader = response.body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  let bytes = 0;
  let text = "";
  const decoder = new TextDecoder();
  try {
    if (signal.aborted) throw new Error("Storage request cancelled.");
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw new Error("Storage request cancelled.");
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16384) throw new Error("Storage response is too large.");
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally {
    signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => undefined);
  }
}

const recoverySchema = z
  .object({
    accountId: z.uuid(),
    versionId: z.uuid(),
    reservationId: z.uuid().nullable(),
    status: z.enum(["none", "reserved", "pending_review", "failed"]),
  })
  .strict();
export function parseStorageRecovery(value: unknown, accountId: string, versionId: string) {
  const result = recoverySchema.parse(value);
  if (
    result.accountId !== accountId ||
    result.versionId !== versionId ||
    (result.status === "none" ? result.reservationId !== null : result.reservationId === null)
  )
    throw new Error("Storage recovery identity changed.");
  return result;
}
export function parseStorageCompletion(
  value: unknown,
  accountId: string,
  versionId: string,
  reservationId: string,
) {
  const result = z
    .object({ ...identity, status: z.literal("pending_review") })
    .strict()
    .parse(value);
  if (
    result.accountId !== accountId ||
    result.versionId !== versionId ||
    result.reservationId !== reservationId
  )
    throw new Error("Storage completion identity changed.");
  return result;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;
const journalSchema = z
  .object({
    requestKey: z.uuid(),
    reservationId: z.uuid().nullable(),
    phase: z.enum(["started", "uncertain", "sent", "complete"]),
  })
  .strict();
export type StorageUploadJournal = z.infer<typeof journalSchema>;
export const storageJournalKey = (accountId: string, versionId: string) =>
  `aiverse:storage-upload:${accountId}:${versionId}`;
export function readStorageJournal(storage: StorageLike, accountId: string, versionId: string) {
  const raw = storage.getItem(storageJournalKey(accountId, versionId));
  return raw === null ? null : journalSchema.parse(JSON.parse(raw));
}
export function writeStorageJournal(
  storage: StorageLike,
  accountId: string,
  versionId: string,
  entry: StorageUploadJournal,
) {
  const key = storageJournalKey(accountId, versionId);
  const value = JSON.stringify(journalSchema.parse(entry));
  storage.setItem(key, value);
  if (storage.getItem(key) !== value) throw new Error("Upload recovery storage is unavailable.");
}

/** Matches StorageFileApi.uploadToSignedUrl: PUT, metadata fields before binary. */
export function transferStorageVideo({
  grant,
  configuredUrl,
  file,
  signal,
  onProgress,
  xhrFactory = () => new XMLHttpRequest(),
  document: page = document,
}: {
  grant: StorageUploadGrant;
  configuredUrl: string;
  file: File;
  signal: AbortSignal;
  onProgress: (value: number | null) => void;
  xhrFactory?: () => XMLHttpRequest;
  document?: Pick<Document, "createElement" | "head">;
}): Promise<void> {
  const { expiresAtMs, ...raw } = grant;
  try {
    if (!validStorageFile(file)) throw new Error();
    parseStorageGrant(raw, grant.accountId, grant.versionId, configuredUrl, file.size);
    if (expiresAtMs !== Date.parse(grant.expiresAt)) throw new Error();
  } catch {
    return Promise.reject(new Error("The file or upload authorization changed."));
  }
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("Upload cancelled."));
    const policy = page.createElement("meta");
    policy.name = "referrer";
    policy.content = "no-referrer";
    page.head.appendChild(policy);
    const xhr = xhrFactory();
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      signal.removeEventListener("abort", cancel);
      xhr.upload.onprogress = null;
      xhr.onload = xhr.onerror = xhr.onabort = xhr.ontimeout = null;
      if (error) reject(error);
      else resolve();
    };
    const cancel = () => {
      finish(new Error("Upload cancelled. Some bytes may have reached Storage."));
      xhr.abort();
    };
    const milliseconds = Math.max(1, Math.min(15 * 60 * 1000, expiresAtMs - Date.now()));
    const deadline = setTimeout(() => {
      finish(new Error("Upload timed out."));
      xhr.abort();
    }, milliseconds);
    signal.addEventListener("abort", cancel, { once: true });
    xhr.upload.onprogress = (event) => {
      if (!settled)
        onProgress(
          event.lengthComputable && event.total > 0
            ? Math.floor(Math.max(0, Math.min(100, (event.loaded / event.total) * 100)))
            : null,
        );
    };
    xhr.onload = () =>
      finish(
        xhr.status >= 200 && xhr.status < 300 && xhr.responseURL === grant.uploadUrl
          ? undefined
          : new Error("Storage did not confirm this upload."),
      );
    xhr.onerror = () => finish(new Error("The upload connection was interrupted."));
    xhr.onabort = () => finish(new Error("Upload cancelled."));
    xhr.ontimeout = () => finish(new Error("Upload timed out."));
    try {
      xhr.open("PUT", grant.uploadUrl, true);
      xhr.withCredentials = false;
      xhr.timeout = milliseconds;
      xhr.setRequestHeader("x-upsert", "false");
      const body = new FormData();
      body.append("cacheControl", "0");
      body.append(
        "",
        file.type === "video/mp4" ? file : new Blob([file], { type: "video/mp4" }),
        "video.mp4",
      );
      xhr.send(body);
    } catch {
      finish(new Error("The upload could not start."));
      xhr.abort();
    }
  });
}
