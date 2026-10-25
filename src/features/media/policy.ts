/** Shared application bounds; authoritative duration and quota are enforced in SQL. */
export const MAX_REEL_SECONDS = 180;
export const MAX_MOVIE_SECONDS = 1200;
export const MAX_UPLOAD_BYTES = 500_000_000;
export const MULTIPART_MAX_BYTES = 200_000_000;
export const MAX_PLAYBACK_TTL_SECONDS = 1260;

export function maxDurationForFormat(format: "reel" | "movie") {
  return format === "movie" ? MAX_MOVIE_SECONDS : MAX_REEL_SECONDS;
}

/** Provider grants are bearer credentials: accept only canonical upload endpoints. */
export function isSafeUploadUrl(value: string, protocol: "multipart" | "tus") {
  if (value.length > 2048) return false;
  try {
    const url = new URL(value);
    return (
      url.href === value &&
      url.protocol === "https:" &&
      url.hostname === "upload.videodelivery.net" &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname.length <= 1024 &&
      (protocol === "multipart"
        ? /^\/[a-f0-9]{32}$/.test(url.pathname)
        : /^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(url.pathname))
    );
  } catch {
    return false;
  }
}
