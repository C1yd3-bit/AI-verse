import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { parseStreamAssetEvidence, type StreamAsset } from "./stream";

export const MAX_WEBHOOK_BYTES = 64 * 1024;
export class StreamWebhookError extends Error {
  constructor(public readonly code: "unconfigured" | "unauthorized" | "invalid_body") {
    super(`Stream webhook rejected: ${code}`);
    this.name = "StreamWebhookError";
  }
}
export interface VerifiedStreamWebhook {
  asset: StreamAsset;
  /** Digest of exact body bytes, for durable business-layer deduplication. */
  eventId: string;
  sentAt: number;
}

/** Authentication only: callers still bind asset/creator/operation to DB state,
 * deduplicate durably and prevent late callbacks resurrecting hidden records. */
export function verifyStreamWebhook(
  rawBody: Uint8Array,
  signature: string | null,
  secret: string,
  options: { now?: () => number } = {},
): VerifiedStreamWebhook {
  if (!secret || secret.length < 16 || secret.length > 512) {
    throw new StreamWebhookError("unconfigured");
  }
  if (rawBody.byteLength === 0 || rawBody.byteLength > MAX_WEBHOOK_BYTES) {
    throw new StreamWebhookError("invalid_body");
  }
  if (!signature || signature.length > 256) throw new StreamWebhookError("unauthorized");
  // Exactly one timestamp and signature: ambiguous/duplicate values fail closed.
  const match = /^time=(\d{1,12}),sig1=([a-fA-F0-9]{64})$/.exec(signature.trim());
  if (!match) throw new StreamWebhookError("unauthorized");
  const sentAt = Number(match[1]);
  const now = Math.floor((options.now ?? Date.now)() / 1000);
  if (!Number.isSafeInteger(sentAt) || now - sentAt > 300 || sentAt - now > 30) {
    throw new StreamWebhookError("unauthorized");
  }
  const expected = createHmac("sha256", secret).update(`${match[1]}.`).update(rawBody).digest();
  const actual = Buffer.from(match[2], "hex");
  if (!timingSafeEqual(expected, actual)) throw new StreamWebhookError("unauthorized");
  try {
    // Decode only after authenticating the unmodified bytes (including newlines).
    const asset = parseStreamAssetEvidence(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBody)),
    );
    return {
      asset,
      sentAt,
      eventId: createHash("sha256").update(rawBody).digest("hex"),
    };
  } catch {
    throw new StreamWebhookError("invalid_body");
  }
}

export async function readAndVerifyStreamWebhook(
  request: Request,
  secret: string,
  options: { now?: () => number } = {},
): Promise<VerifiedStreamWebhook> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_WEBHOOK_BYTES)) {
    throw new StreamWebhookError("invalid_body");
  }
  if (!request.body) throw new StreamWebhookError("invalid_body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const read = (async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_WEBHOOK_BYTES) throw new StreamWebhookError("invalid_body");
        chunks.push(value);
      }
      return Buffer.concat(chunks);
    })();
    const body = await Promise.race([
      read,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new StreamWebhookError("invalid_body")), 10000);
      }),
    ]);
    return verifyStreamWebhook(body, request.headers.get("webhook-signature"), secret, options);
  } catch (error) {
    if (error instanceof StreamWebhookError) throw error;
    throw new StreamWebhookError("invalid_body");
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
  }
}
