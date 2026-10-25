import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/lib/env";

/** Internal provider jobs and sealed normalized-artwork ingress only.
 * Never use this client for broad user-owned mutations. Artwork RPCs recheck the
 * verified server identity and exact draft under database locks. */
export function createSupabaseAdminClient() {
  const config = getSupabaseConfig();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!config || !key || key.length < 20) return null;
  return createClient(config.url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
