import { createClient } from "@supabase/supabase-js";
import { createMediaStorageHandler } from "./core.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response>): void;
};
const url = Deno.env.get("SUPABASE_URL") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const handler = createMediaStorageHandler({
  url,
  anonKey,
  serviceKey,
  publicUrl: Deno.env.get("AIVERSE_PUBLIC_SUPABASE_URL"),
  createClient: (key, authorization) =>
    createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: authorization ? { headers: { Authorization: authorization } } : undefined,
    }),
});
// Mixed public playback + verified-user completion: JWT identity is validated inside the handler.
Deno.serve(async (request) => {
  try {
    return await handler(request);
  } catch {
    return Response.json(
      { error: "Media service is temporarily unavailable." },
      {
        status: 503,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }
});
