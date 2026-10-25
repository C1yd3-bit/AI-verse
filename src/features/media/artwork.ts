import "server-only";
import sharp from "sharp";
import {
  MAX_ARTWORK_DATA_LENGTH,
  MAX_ARTWORK_INPUT_BYTES,
  MAX_ARTWORK_OUTPUT_BYTES,
} from "./artwork-schema";

const prefix = "data:image/webp;base64,";
const formats: Record<string, string> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};
export class ArtworkInputError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}
async function readBytes(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new ArtworkInputError("Choose a thumbnail image.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ArtworkInputError("Thumbnail upload timed out. Choose the image again.", 408));
      void reader.cancel().catch(() => undefined);
    }, 10_000);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_ARTWORK_INPUT_BYTES) {
        await reader.cancel();
        throw new ArtworkInputError("Choose a thumbnail no larger than 5 MB.", 413);
      }
      chunks.push(value);
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
  if (!size) throw new ArtworkInputError("Choose a thumbnail image.");
  return Buffer.concat(chunks, size);
}
function animatedPng(bytes: Buffer) {
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
/** Decode real still image bytes, honor EXIF orientation, preserve aspect and strip metadata. */
export async function normalizeArtwork(request: Request) {
  const format = formats[request.headers.get("content-type")?.toLowerCase().trim() ?? ""];
  if (!format) throw new ArtworkInputError("Choose a still JPEG, PNG or WebP thumbnail.", 415);
  const bytes = await readBytes(request);
  try {
    const image = sharp(bytes, { limitInputPixels: 16_000_000, failOn: "warning" });
    const metadata = await image.metadata();
    if (
      metadata.format !== format ||
      (metadata.pages ?? 1) !== 1 ||
      (format === "png" && animatedPng(bytes)) ||
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > 16_000_000
    )
      throw new Error("Invalid still image");
    for (const quality of [80, 65, 45]) {
      const output = await image
        .clone()
        .autoOrient()
        .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
        .webp({ quality })
        .toBuffer();
      const data = prefix + output.toString("base64");
      if (output.length <= MAX_ARTWORK_OUTPUT_BYTES && data.length <= MAX_ARTWORK_DATA_LENGTH)
        return data;
    }
    throw new Error("Output too large");
  } catch {
    throw new ArtworkInputError(
      "Choose a valid still JPEG, PNG or WebP up to 16 megapixels; try a smaller image.",
    );
  }
}
/** Only our sealed write RPC accepts normalized images; still reject corrupt DB projections. */
export function artworkBytes(value: unknown): Buffer | null {
  if (
    typeof value !== "string" ||
    value.length > MAX_ARTWORK_DATA_LENGTH ||
    !value.startsWith(prefix)
  )
    return null;
  const encoded = value.slice(prefix.length);
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
    return null;
  const bytes = Buffer.from(encoded, "base64");
  return bytes.length >= 12 &&
    bytes.length <= MAX_ARTWORK_OUTPUT_BYTES &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP" &&
    bytes.toString("base64") === encoded
    ? bytes
    : null;
}
