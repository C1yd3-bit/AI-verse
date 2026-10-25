"use client";
import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseConfig } from "@/lib/env";

export function createSupabaseBrowserClient() {
  const config = getSupabaseConfig();
  return config ? createBrowserClient(config.url, config.key) : null;
}
