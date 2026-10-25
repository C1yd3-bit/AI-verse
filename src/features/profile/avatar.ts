import "server-only";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";

export const MAX_AVATAR_INPUT_BYTES = 5 * 1024 * 1024;
export const MAX_AVATAR_OUTPUT_BYTES = 64 * 1024;
const MAX_AVATAR_PIXELS = 16_000_000;
const prefix = "data:image/webp;base64,";
const formats: Record<string, string> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};

export class AvatarInputError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

/** Bound streamed bytes even when Content-Length is absent or dishonest. */
async function readPhotoBytes(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new AvatarInputError("Choose a photo to upload.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_AVATAR_INPUT_BYTES) {
        await reader.cancel();
        throw new AvatarInputError("Choose a photo smaller than 5 MB.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!total) throw new AvatarInputError("Choose a photo to upload.");
  return Buffer.concat(chunks, total);
}

// libpng can decode only the default APNG frame without reporting metadata.pages.
// Reject its animation-control chunk instead of silently accepting that frame.
function hasPngAnimation(bytes: Buffer) {
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const size = bytes.readUInt32BE(offset);
    if (size > bytes.length - offset - 12) return false;
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "acTL") return true;
    if (type === "IEND") return false;
    offset += size + 12;
  }
  return false;
}

export async function normalizeAvatar(request: Request): Promise<string> {
  const mime = request.headers.get("content-type")?.toLowerCase().trim() ?? "";
  const expectedFormat = formats[mime];
  if (!expectedFormat) throw new AvatarInputError("Choose a JPEG, PNG or WebP photo.", 415);
  const bytes = await readPhotoBytes(request);
  try {
    const photo = sharp(bytes, { limitInputPixels: MAX_AVATAR_PIXELS, failOn: "warning" });
    const metadata = await photo.metadata();
    if (
      metadata.format !== expectedFormat ||
      (metadata.format === "png" && hasPngAnimation(bytes)) ||
      (metadata.pages ?? 1) !== 1 ||
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > MAX_AVATAR_PIXELS
    )
      throw new Error("Invalid static photo");
    // Sharp strips EXIF/ICC/XMP by default; autoOrient honors orientation before cropping.
    const normalized = await photo
      .autoOrient()
      .resize(256, 256, {
        fit: "cover",
        position: "centre",
      })
      .webp({ quality: 80 })
      .toBuffer();
    if (normalized.byteLength > MAX_AVATAR_OUTPUT_BYTES) throw new Error("Output too large");
    return prefix + normalized.toString("base64");
  } catch {
    throw new AvatarInputError(
      "Choose a valid, still JPEG, PNG or WebP photo up to 16 megapixels.",
    );
  }
}

/** Treat database content as untrusted, including calls made outside our route. */
export function isCanonicalAvatar(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith(prefix) || value.length > 87407) return false;
  const base64 = value.slice(prefix.length);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))
    return false;
  const bytes = Buffer.from(base64, "base64");
  return (
    bytes.length >= 12 &&
    bytes.length <= MAX_AVATAR_OUTPUT_BYTES &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP" &&
    bytes.toString("base64") === base64
  );
}

export async function readAvatar(client: SupabaseClient) {
  const result = await client.rpc("get_my_avatar");
  if (result.error) return result;
  if (result.data !== null && !isCanonicalAvatar(result.data))
    return { data: null, error: { code: "invalid_projection" } };
  return { data: result.data as string | null, error: null };
}
