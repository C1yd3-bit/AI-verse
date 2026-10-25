import "server-only";
import { z } from "zod";
import {
  isSafeUploadUrl,
  MAX_MOVIE_SECONDS,
  MAX_PLAYBACK_TTL_SECONDS,
  MAX_UPLOAD_BYTES,
  MULTIPART_MAX_BYTES,
} from "./policy";
export { MAX_PLAYBACK_TTL_SECONDS } from "./policy";

const identifier = z.string().regex(/^[a-f0-9]{32}$/);
const reference = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const configSchema = z.object({
  accountId: identifier,
  apiToken: z.string().regex(/^[A-Za-z0-9_-]{20,256}$/),
});
const MAX_BODY_BYTES = 64 * 1024;
export type StreamConfig = z.infer<typeof configSchema>;
export type StreamErrorCode =
  | "unconfigured"
  | "invalid_input"
  | "timeout"
  | "unavailable"
  | "provider_failure"
  | "invalid_response"
  | "unsafe_asset";

/** Never include request URLs, response bodies, credentials or tokens in errors. */
export class StreamProviderError extends Error {
  constructor(
    public readonly code: StreamErrorCode,
    public readonly status?: number,
  ) {
    super(`Stream operation failed: ${code}`);
    this.name = "StreamProviderError";
  }
}

export function getStreamConfig(
  env: Record<string, string | undefined> = process.env,
): StreamConfig | null {
  const result = configSchema.safeParse({
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    apiToken: env.CLOUDFLARE_STREAM_API_TOKEN,
  });
  return result.success ? result.data : null;
}

const assetSchema = z.object({
  uid: identifier,
  creator: reference.nullish(),
  meta: z.object({ operationKey: reference.optional() }).nullish(),
  status: z.object({
    state: z.enum([
      "pendingupload",
      "downloading",
      "queued",
      "inprogress",
      "ready",
      "error",
      "live-inprogress",
    ]),
  }),
  readyToStream: z.boolean(),
  requireSignedURLs: z.boolean(),
  duration: z.number().finite().min(0).max(36000).nullish(),
});

export interface StreamAsset {
  assetId: string;
  creatorId: string | null;
  operationKey: string | null;
  state: z.infer<typeof assetSchema>["status"]["state"];
  readyToStream: boolean;
  requireSignedURLs: boolean;
  durationSeconds: number | null;
}

/** Shared parser for authenticated API responses and signature-verified webhook bodies. */
export function parseStreamAssetEvidence(value: unknown): StreamAsset {
  const result = assetSchema.safeParse(value);
  if (!result.success) throw new StreamProviderError("invalid_response");
  const asset = result.data;
  return {
    assetId: asset.uid,
    creatorId: asset.creator ?? null,
    operationKey: asset.meta?.operationKey ?? null,
    state: asset.status.state,
    readyToStream: asset.readyToStream,
    requireSignedURLs: asset.requireSignedURLs,
    durationSeconds: asset.duration ?? null,
  };
}

export interface DirectUploadInput {
  creatorId: string;
  operationKey: string;
  maxDurationSeconds: number;
  expiresAt: Date;
  /** Required by HTTP ingress; absent only for legacy internal multipart callers. */
  fileSize?: number;
}
export interface DirectUploadGrant {
  assetId: string;
  uploadUrl: string;
  expiresAt: string;
  protocol: "multipart" | "tus";
}
export interface PlaybackGrant {
  token: string;
  /** Unix epoch seconds, confirmed from the returned token. */
  expiresAt: number;
}
export interface StreamProvider {
  createDirectUpload(input: DirectUploadInput): Promise<DirectUploadGrant>;
  getAsset(assetId: string): Promise<StreamAsset>;
  createPlaybackToken(
    assetId: string,
    ttlSeconds?: number,
    absoluteExpiresAt?: number,
  ): Promise<PlaybackGrant>;
  deleteAsset(assetId: string): Promise<void>;
}

function requireInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new StreamProviderError("invalid_input");
  return parsed.data;
}

async function readJsonBounded(response: Response, signal: AbortSignal): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    await response.body?.cancel();
    throw new StreamProviderError("invalid_response");
  }
  if (!response.body) throw new StreamProviderError("invalid_response");
  const reader = response.body.getReader();
  const abortRead = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener("abort", abortRead, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new StreamProviderError("invalid_response");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof StreamProviderError) throw error;
    throw new StreamProviderError("invalid_response");
  } finally {
    signal.removeEventListener("abort", abortRead);
    reader.releaseLock();
  }
}

/**
 * This boundary performs provider I/O, never authorization or publication.
 * Callers must first reserve quota and persist operationKey. Ambiguous upload
 * failures require reconciliation; metadata is not provider-side idempotency.
 */
export function createStreamProvider(
  config: StreamConfig,
  options: { fetch?: typeof fetch; now?: () => number; timeoutMs?: number } = {},
): StreamProvider {
  const parsedConfig = configSchema.safeParse(config);
  if (!parsedConfig.success) throw new StreamProviderError("unconfigured");
  const { accountId, apiToken } = parsedConfig.data;
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = requireInput(z.number().int().min(1).max(30000), options.timeoutMs ?? 10000);
  const baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream`;

  async function request(
    path: string,
    method: string,
    body?: unknown,
    tusHeaders?: Record<string, string>,
  ): Promise<unknown> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetcher(`${baseUrl}${path}`, {
            method,
            headers: tusHeaders
              ? { Authorization: `Bearer ${apiToken}`, ...tusHeaders }
              : { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: controller.signal,
            redirect: "error",
            cache: "no-store",
            credentials: "omit",
            referrerPolicy: "no-referrer",
          });
          if (method === "DELETE" && response.status === 404) {
            void response.body?.cancel().catch(() => undefined);
            return null;
          }
          if (!response.ok) {
            void response.body?.cancel().catch(() => undefined);
            throw new StreamProviderError("provider_failure", response.status);
          }
          if (tusHeaders) {
            // The upload endpoint is opaque; obtain identity from the dedicated header.
            const result = {
              uid: response.headers.get("stream-media-id"),
              uploadURL: response.headers.get("location"),
            };
            void response.body?.cancel().catch(() => undefined);
            if (response.status !== 201) throw new StreamProviderError("invalid_response");
            return result;
          }
          const envelope = z
            .object({ success: z.literal(true), result: z.unknown() })
            .safeParse(await readJsonBounded(response, controller.signal));
          if (!envelope.success) throw new StreamProviderError("invalid_response");
          return envelope.data.result;
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new StreamProviderError("timeout"));
            controller.abort();
          }, timeoutMs);
        }),
      ]);
    } catch (error) {
      if (error instanceof StreamProviderError) throw error;
      throw new StreamProviderError("unavailable");
    } finally {
      clearTimeout(timer);
    }
  }

  async function getAsset(assetId: string): Promise<StreamAsset> {
    requireInput(identifier, assetId);
    const asset = parseStreamAssetEvidence(await request(`/${assetId}`, "GET"));
    if (asset.assetId !== assetId) throw new StreamProviderError("invalid_response");
    return asset;
  }

  return {
    async createDirectUpload(input) {
      requireInput(reference, input.creatorId);
      requireInput(reference, input.operationKey);
      // SQL reserves the immutable format's bounded allowance. Never use -1.
      requireInput(z.number().int().min(1).max(MAX_MOVIE_SECONDS), input.maxDurationSeconds);
      if (input.fileSize !== undefined)
        requireInput(z.number().int().min(1).max(MAX_UPLOAD_BYTES), input.fileSize);
      requireInput(z.date(), input.expiresAt);
      const expires = input.expiresAt.getTime();
      if (expires <= now() || expires > now() + 60 * 60 * 1000) {
        throw new StreamProviderError("invalid_input");
      }
      const expiresAt = input.expiresAt.toISOString();
      const protocol = (input.fileSize ?? 1) > MULTIPART_MAX_BYTES ? "tus" : "multipart";
      const metadata = (key: string, value: string) =>
        `${key} ${Buffer.from(value).toString("base64")}`;
      const result =
        protocol === "tus"
          ? await request("?direct_user=true", "POST", undefined, {
              "Tus-Resumable": "1.0.0",
              "Upload-Length": String(input.fileSize),
              "Upload-Creator": input.creatorId,
              "Upload-Metadata": [
                metadata("maxDurationSeconds", String(input.maxDurationSeconds)),
                "requiresignedurls",
                metadata("expiry", expiresAt),
                metadata("operationKey", input.operationKey),
              ].join(","),
            })
          : await request("/direct_upload", "POST", {
              maxDurationSeconds: input.maxDurationSeconds,
              expiry: expiresAt,
              creator: input.creatorId,
              meta: { operationKey: input.operationKey },
              requireSignedURLs: true,
            });
      const parsed = z.object({ uid: identifier, uploadURL: z.url().max(2048) }).safeParse(result);
      if (!parsed.success) throw new StreamProviderError("invalid_response");
      if (
        !isSafeUploadUrl(parsed.data.uploadURL, protocol) ||
        (protocol === "multipart" &&
          new URL(parsed.data.uploadURL).pathname !== `/${parsed.data.uid}`)
      ) {
        throw new StreamProviderError("invalid_response");
      }
      return { assetId: parsed.data.uid, uploadUrl: parsed.data.uploadURL, expiresAt, protocol };
    },
    getAsset,
    async createPlaybackToken(assetId, ttlSeconds = 300, absoluteExpiresAt) {
      requireInput(identifier, assetId);
      requireInput(z.number().int().min(1).max(MAX_PLAYBACK_TTL_SECONDS), ttlSeconds);
      const asset = await getAsset(assetId);
      if (
        !asset.requireSignedURLs ||
        !asset.readyToStream ||
        asset.state !== "ready" ||
        !asset.durationSeconds
      ) {
        throw new StreamProviderError("unsafe_asset");
      }
      const issuedAt = Math.floor(now() / 1000);
      if (absoluteExpiresAt !== undefined)
        requireInput(z.number().int().positive(), absoluteExpiresAt);
      const exp = Math.min(issuedAt + ttlSeconds, absoluteExpiresAt ?? Infinity);
      if (exp <= issuedAt) throw new StreamProviderError("unsafe_asset");
      const result = z
        .object({
          token: z
            .string()
            .min(20)
            .max(16384)
            .regex(/^[\w-]+\.[\w-]+\.[\w-]+$/),
        })
        .safeParse(await request(`/${assetId}/token`, "POST", { exp, downloadable: false }));
      if (!result.success) throw new StreamProviderError("invalid_response");
      // HTTPS authenticates the provider response; inspect claims to fail closed if
      // the provider ignored the requested expiry. This is not JWT verification.
      try {
        const claims = z
          .object({
            sub: z.literal(assetId),
            exp: z.number().int(),
            downloadable: z.literal(false).optional(),
          })
          .parse(JSON.parse(Buffer.from(result.data.token.split(".")[1], "base64url").toString()));
        if (claims.exp <= Math.floor(now() / 1000) || claims.exp > exp) {
          throw new StreamProviderError("invalid_response");
        }
        return { token: result.data.token, expiresAt: claims.exp };
      } catch {
        throw new StreamProviderError("invalid_response");
      }
    },
    async deleteAsset(assetId) {
      requireInput(identifier, assetId);
      await request(`/${assetId}`, "DELETE");
    },
  };
}
