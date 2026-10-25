import { isSafeUploadUrl, MAX_UPLOAD_BYTES, MULTIPART_MAX_BYTES } from "./policy";

// Cloudflare requires nonfinal chunks to be >= 5 MiB and divisible by 256 KiB.
export const TUS_CHUNK_BYTES = 8 * 1024 * 1024;
type TusGrant = {
  protocol: "multipart" | "tus";
  uploadUrl: string;
  fileSize: number;
  expiresAtMs: number;
};
const uncertain =
  "The video service did not confirm the transfer. Refresh status before continuing; no retry was started.";

function integerHeader(xhr: XMLHttpRequest, name: string) {
  const raw = xhr.getResponseHeader(name);
  if (raw === null || !/^(0|[1-9]\d*)$/.test(raw) || !Number.isSafeInteger(Number(raw)))
    throw new Error(uncertain);
  return Number(raw);
}

/** Continue the server-created TUS resource; never POST another resource or retry a PATCH. */
export async function transferTusVideo({
  grant,
  file,
  signal,
  onProgress,
  xhrFactory,
  document: page,
}: {
  grant: TusGrant;
  file: File;
  signal: AbortSignal;
  onProgress: (percentage: number | null) => void;
  xhrFactory: () => XMLHttpRequest;
  document: Pick<Document, "createElement" | "head">;
}): Promise<void> {
  if (
    signal.aborted ||
    grant.protocol !== "tus" ||
    !isSafeUploadUrl(grant.uploadUrl, "tus") ||
    !Number.isSafeInteger(file.size) ||
    file.size <= MULTIPART_MAX_BYTES ||
    file.size > MAX_UPLOAD_BYTES ||
    file.size !== grant.fileSize ||
    !Number.isFinite(grant.expiresAtMs) ||
    grant.expiresAtMs <= Date.now()
  )
    throw new Error(
      "The upload authorization expired or changed. Refresh status before continuing.",
    );
  const deadlineAt = Math.min(grant.expiresAtMs, Date.now() + 15 * 60 * 1000);
  const policy = page.createElement("meta");
  policy.name = "referrer";
  policy.content = "no-referrer";
  page.head.appendChild(policy);

  function request(method: "HEAD" | "PATCH", offset = 0, chunk?: Blob): Promise<number> {
    return new Promise((resolve, reject) => {
      if (signal.aborted)
        return reject(new Error("Upload cancelled. Refresh status before continuing."));
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0)
        return reject(new Error("The upload timed out. Refresh status before continuing."));
      const xhr = xhrFactory();
      let settled = false;
      const finish = (error?: Error, nextOffset?: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        signal.removeEventListener("abort", cancel);
        xhr.upload.onprogress = null;
        xhr.onload = xhr.onerror = xhr.ontimeout = xhr.onabort = null;
        if (error) reject(error);
        else resolve(nextOffset!);
      };
      const cancel = () => {
        finish(
          new Error(
            "Upload cancelled. Some data may have reached the service. Refresh status before continuing.",
          ),
        );
        xhr.abort();
      };
      const deadline = setTimeout(() => {
        finish(
          new Error(
            "The upload timed out. Refresh status before continuing; no retry was started.",
          ),
        );
        xhr.abort();
      }, remaining);
      signal.addEventListener("abort", cancel, { once: true });
      xhr.upload.onprogress = (event) => {
        if (settled || method !== "PATCH" || !chunk) return;
        onProgress(
          event.lengthComputable &&
            event.total === chunk.size &&
            Number.isFinite(event.loaded) &&
            event.loaded >= 0
            ? Math.floor(((offset + Math.min(event.loaded, chunk.size)) / file.size) * 100)
            : null,
        );
      };
      xhr.onload = () => {
        try {
          if (Date.now() >= deadlineAt)
            throw new Error("The upload timed out. Refresh status before continuing.");
          if (
            xhr.responseURL !== grant.uploadUrl ||
            xhr.getResponseHeader("Tus-Resumable") !== "1.0.0"
          )
            throw new Error(uncertain);
          const nextOffset = integerHeader(xhr, "Upload-Offset");
          if (
            method === "HEAD"
              ? ![200, 204].includes(xhr.status) ||
                integerHeader(xhr, "Upload-Length") !== file.size ||
                nextOffset > file.size
              : xhr.status !== 204 || nextOffset !== offset + chunk!.size
          )
            throw new Error(uncertain);
          finish(undefined, nextOffset);
        } catch {
          finish(new Error(uncertain));
        }
      };
      xhr.onerror = () =>
        finish(
          new Error(
            "The connection was interrupted. Refresh status before continuing; no retry was started.",
          ),
        );
      xhr.ontimeout = () =>
        finish(
          new Error(
            "The upload timed out. Refresh status before continuing; no retry was started.",
          ),
        );
      xhr.onabort = () => finish(new Error("Upload cancelled. Refresh status before continuing."));
      try {
        xhr.open(method, grant.uploadUrl, true);
        xhr.withCredentials = false;
        xhr.timeout = remaining;
        xhr.setRequestHeader("Tus-Resumable", "1.0.0");
        if (method === "PATCH") {
          xhr.setRequestHeader("Upload-Offset", String(offset));
          xhr.setRequestHeader("Content-Type", "application/offset+octet-stream");
        }
        if (signal.aborted) return cancel();
        xhr.send(chunk ?? null);
      } catch {
        finish(
          new Error(
            "The upload could not start. Refresh status before continuing; no retry was started.",
          ),
        );
        xhr.abort();
      }
    });
  }

  let offset = await request("HEAD");
  if (signal.aborted) throw new Error("Upload cancelled. Refresh status before continuing.");
  onProgress(Math.floor((offset / file.size) * 100));
  while (offset < file.size) {
    const end = Math.min(offset + TUS_CHUNK_BYTES, file.size);
    const chunk = file.slice(offset, end);
    if (chunk.size !== end - offset)
      throw new Error("The selected file changed. Refresh status before continuing.");
    offset = await request("PATCH", offset, chunk);
    if (signal.aborted) throw new Error("Upload cancelled. Refresh status before continuing.");
    onProgress(Math.floor((offset / file.size) * 100));
  }
}
