import { z } from "zod";

const providerSchema = z.object({
  url: z.url().refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" ||
        (url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))
      );
    } catch {
      return false;
    }
  }, "Use HTTPS outside local development"),
  key: z.string().min(20),
});

/** Only public project credentials; never use a service-role key here. */
export function getSupabaseConfig() {
  const result = providerSchema.safeParse({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  return result.success ? result.data : null;
}
