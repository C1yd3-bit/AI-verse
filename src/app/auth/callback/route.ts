import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getRequestOrigin } from "@/features/auth/request";
import { accountDestination } from "@/features/auth/onboarding";

export async function GET(request: Request) {
  const url = new URL(request.url);
  let origin;
  try {
    origin = getRequestOrigin(request);
  } catch {
    return NextResponse.json({ error: "Invalid request host" }, { status: 400 });
  }
  const code = url.searchParams.get("code");
  const client = await createSupabaseServerClient();
  if (code && client) {
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error) {
      const identity = await client.auth.getUser();
      if (!identity.error && identity.data.user?.email_confirmed_at) {
        const destination = await accountDestination(client, identity.data.user.id);
        const response = NextResponse.redirect(new URL(destination, origin));
        response.headers.set("Cache-Control", "private, no-store");
        return response;
      }
      await client.auth.signOut({ scope: "local" });
    }
  }
  return NextResponse.redirect(new URL("/login?error=confirmation", origin));
}
