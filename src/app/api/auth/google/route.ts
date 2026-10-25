import { NextResponse } from "next/server";
import { apiResponse } from "@/features/auth/guard";
import { getRequestOrigin } from "@/features/auth/request";
import { getAuthProviderSettings } from "@/features/auth/settings";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/env";

export async function GET(request: Request) {
  let origin: string;
  try {
    origin = getRequestOrigin(request);
  } catch {
    return apiResponse({ error: "Invalid request host" }, 400);
  }
  const config = getSupabaseConfig();
  const settings = await getAuthProviderSettings();
  if (!config || !settings?.google)
    return apiResponse({ error: "Google sign-in is not configured. Use email to continue." }, 503);
  const client = await createSupabaseServerClient();
  if (!client) return apiResponse({ error: "Account services are not configured" }, 503);
  const result = await client.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${origin}/auth/callback`, skipBrowserRedirect: true },
  });
  if (result.error || !result.data.url)
    return apiResponse({ error: "Google sign-in could not start. Please try again later." }, 502);
  try {
    const target = new URL(result.data.url);
    const expected = new URL(config.url);
    if (
      target.origin !== expected.origin ||
      target.pathname !== `${expected.pathname.replace(/\/$/, "")}/auth/v1/authorize`
    )
      return apiResponse({ error: "Google sign-in could not start." }, 502);
    const response = NextResponse.redirect(target);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch {
    return apiResponse({ error: "Google sign-in could not start." }, 502);
  }
}
