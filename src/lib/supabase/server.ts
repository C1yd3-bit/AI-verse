import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseConfig } from "@/lib/env";

export async function createSupabaseServerClient(options: { readOnlyCookies?: boolean } = {}) {
  const config = getSupabaseConfig();
  if (!config) return null;
  const cookieStore = await cookies();
  return createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (updates) => {
        // Server Component guards cannot mutate cookies. Route handlers retain
        // strict writable behavior so a failed session write is never hidden.
        if (options.readOnlyCookies) return;
        updates.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
      },
    },
  });
}
