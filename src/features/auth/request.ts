import { z } from "zod";

export const authInputSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("login"),
      email: z.email().max(254),
      password: z.string().min(1).max(128),
    })
    .strict(),
  z
    .object({
      action: z.literal("signup"),
      email: z.email().max(254),
      password: z.string().min(12).max(128),
    })
    .strict(),
  z.object({ action: z.literal("logout") }).strict(),
  z
    .object({
      action: z.literal("verify_signup"),
      email: z.email().max(254),
      code: z.string().regex(/^\d{6}$/),
    })
    .strict(),
  z.object({ action: z.literal("resend_signup"), email: z.email().max(254) }).strict(),
]);

/** Next may construct request.url with localhost while the browser uses 127.0.0.1.
 * Use the actual HTTP Host, never an untrusted forwarded-host header. */
export function getRequestOrigin(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("host");
  if (!host) return url.origin;
  const authority = new URL(`${url.protocol}//${host}`);
  if (authority.host !== host.toLowerCase() || authority.username || authority.password)
    throw new Error("Invalid request host");
  return authority.origin;
}

/** Cookies authorize mutations only from our own browser origin. */
export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  try {
    return origin !== null && origin === getRequestOrigin(request);
  } catch {
    return false;
  }
}

export async function readBoundedJson(request: Request, limit = 8192): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    throw new Error("Expected JSON");
  if (!Number.isInteger(limit) || limit < 1 || limit > 65536)
    throw new Error("Invalid request bound");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error("Body too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
