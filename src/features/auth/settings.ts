import "server-only";
import { z } from "zod";
import { getSupabaseConfig } from "@/lib/env";

const settingsSchema = z.object({
  mailer_autoconfirm: z.boolean(),
  external: z.object({ google: z.boolean().optional() }).passthrough(),
});
export async function getAuthProviderSettings() {
  const config = getSupabaseConfig();
  if (!config) return null;
  try {
    const response = await fetch(`${config.url.replace(/\/$/, "")}/auth/v1/settings`, {
      headers: { apikey: config.key },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok || !response.body) return null;
    const reader = response.body.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 32768) {
          await reader.cancel();
          return null;
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const parsed = settingsSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    return parsed.success
      ? {
          emailConfirmation: !parsed.data.mailer_autoconfirm,
          google: parsed.data.external.google === true,
        }
      : null;
  } catch {
    return null;
  }
}
