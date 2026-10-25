import { z } from "zod";
import { isSafeUploadUrl, MAX_UPLOAD_BYTES, MULTIPART_MAX_BYTES } from "./policy";
import { transferTusVideo } from "./tus-client";

export { MAX_UPLOAD_BYTES } from "./policy";
export async function readUploadResponse(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (!response.body || (length !== null && (!/^\d+$/.test(length) || Number(length) > 8192))) {
    await response.body?.cancel();
    throw new Error("Upload authorization response is unavailable.");
  }
  const reader = response.body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  let result = "";
  let bytes = 0;
  const decoder = new TextDecoder();
  try {
    if (signal.aborted) throw new Error("Upload authorization cancelled.");
    while (true) {
      const { value, done } = await reader.read();
      if (signal.aborted) throw new Error("Upload authorization cancelled.");
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8192) throw new Error("Upload authorization response is too large.");
      result += decoder.decode(value, { stream: true });
    }
    return JSON.parse(result + decoder.decode()) as unknown;
  } finally {
    signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => undefined);
  }
}
const grantSchema = z
  .object({
    accountId: z.uuid(),
    versionId: z.uuid(),
    uploadUrl: z.url().max(2048),
    expiresAt: z.iso.datetime({ offset: true }),
    reservationId: z.uuid(),
    protocol: z.enum(["multipart", "tus"]),
    fileSize: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  })
  .strict();

/** Upload capabilities stay in memory; neither URLs nor file details enter storage. */
export function parseUploadGrant(
  value: unknown,
  accountId: string,
  versionId: string,
  now = Date.now(),
  expectedFileSize?: number,
) {
  const grant = grantSchema.parse(value);
  const expiresAt = Date.parse(grant.expiresAt);
  if (
    grant.accountId !== accountId ||
    grant.versionId !== versionId ||
    !isSafeUploadUrl(grant.uploadUrl, grant.protocol) ||
    (grant.fileSize <= MULTIPART_MAX_BYTES
      ? grant.protocol !== "multipart"
      : grant.protocol !== "tus") ||
    (expectedFileSize !== undefined && grant.fileSize !== expectedFileSize) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= now ||
    expiresAt > now + 60 * 60 * 1000
  )
    throw new Error(
      "The upload authorization could not be verified. Refresh status before continuing.",
    );
  return { ...grant, expiresAtMs: expiresAt };
}

export function validUploadFile(value: unknown): value is File {
  return (
    value instanceof File &&
    value.size > 0 &&
    Number.isSafeInteger(value.size) &&
    value.size <= MAX_UPLOAD_BYTES &&
    /\.(mp4|mov)$/i.test(value.name) &&
    ["video/mp4", "video/quicktime", ""].includes(value.type)
  );
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;
const journalSchema = z
  .object({ requestKey: z.uuid(), phase: z.enum(["started", "uncertain", "sent"]) })
  .strict();
export type UploadJournal = z.infer<typeof journalSchema>;
export function uploadJournalKey(accountId: string, versionId: string) {
  return `aiverse:upload-attempt:${accountId}:${versionId}`;
}
export function readUploadJournal(
  storage: StorageLike,
  accountId: string,
  versionId: string,
): UploadJournal | null {
  const raw = storage.getItem(uploadJournalKey(accountId, versionId));
  if (raw === null) return null;
  // Unknown/corrupted entries fail closed: they may represent an earlier grant.
  return journalSchema.parse(JSON.parse(raw));
}
export function writeUploadJournal(
  storage: StorageLike,
  accountId: string,
  versionId: string,
  entry: UploadJournal,
) {
  const key = uploadJournalKey(accountId, versionId);
  const raw = JSON.stringify(journalSchema.parse(entry));
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw new Error("Upload recovery storage is unavailable.");
}

/** XHR supplies real transfer progress. No capability or file details enter storage. */
export function transferVideo({
  grant,
  file,
  signal,
  onProgress,
  xhrFactory = () => new XMLHttpRequest(),
  document: page = document,
}: {
  grant: ReturnType<typeof parseUploadGrant>;
  file: File;
  signal: AbortSignal;
  onProgress: (percentage: number | null) => void;
  xhrFactory?: () => XMLHttpRequest;
  document?: Pick<Document, "createElement" | "head">;
}): Promise<void> {
  if (
    !validUploadFile(file) ||
    grant.fileSize !== file.size ||
    !Number.isFinite(grant.expiresAtMs) ||
    !isSafeUploadUrl(grant.uploadUrl, grant.protocol) ||
    (file.size <= MULTIPART_MAX_BYTES ? grant.protocol !== "multipart" : grant.protocol !== "tus")
  )
    return Promise.reject(
      new Error("The file or upload authorization changed. Refresh status before continuing."),
    );
  if (grant.protocol === "tus")
    return transferTusVideo({ grant, file, signal, onProgress, xhrFactory, document: page });
  return new Promise((resolve, reject) => {
    if (signal.aborted)
      return reject(new Error("Upload cancelled. Refresh status before continuing."));
    if (grant.expiresAtMs <= Date.now() || !validUploadFile(file))
      return reject(
        new Error(
          "The upload authorization expired or the file changed. Refresh status before continuing.",
        ),
      );
    // XHR has no per-request referrerPolicy. A document policy applies even after
    // SPA navigation from another page. Keep the stricter privacy policy in place.
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
      xhr.onload = xhr.onerror = xhr.ontimeout = xhr.onabort = null;
      if (error) reject(error);
      else resolve();
    };
    const cancel = () => {
      finish(
        new Error(
          "Upload cancelled. Some data may have reached the service. Refresh status before continuing.",
        ),
      );
      xhr.abort();
    };
    const deadline = setTimeout(
      () => {
        finish(
          new Error(
            "The upload timed out. Refresh status before continuing; no retry was started.",
          ),
        );
        xhr.abort();
      },
      Math.max(1, Math.min(15 * 60 * 1000, grant.expiresAtMs - Date.now())),
    );
    signal.addEventListener("abort", cancel, { once: true });
    xhr.upload.onprogress = (event) => {
      if (!settled)
        onProgress(
          event.lengthComputable && event.total > 0
            ? Math.min(100, Math.max(0, Math.floor((event.loaded / event.total) * 100)))
            : null,
        );
    };
    xhr.onload = () =>
      finish(
        xhr.status >= 200 && xhr.status < 300 && xhr.responseURL === grant.uploadUrl
          ? undefined
          : new Error("The service did not confirm the upload. Refresh status before continuing."),
      );
    xhr.onerror = () =>
      finish(new Error("The connection was interrupted. Refresh status before continuing."));
    xhr.ontimeout = () =>
      finish(new Error("The upload timed out. Refresh status before continuing."));
    xhr.onabort = () => finish(new Error("Upload cancelled. Refresh status before continuing."));
    try {
      xhr.open("POST", grant.uploadUrl, true);
      xhr.withCredentials = false;
      xhr.timeout = Math.max(1, Math.min(15 * 60 * 1000, grant.expiresAtMs - Date.now()));
      const payload = new FormData();
      payload.append("file", file);
      xhr.send(payload);
    } catch {
      finish(new Error("The upload could not start. Refresh status before continuing."));
      xhr.abort();
    }
  });
}
