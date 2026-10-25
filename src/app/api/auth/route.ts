import {
  authInputSchema,
  getRequestOrigin,
  isSameOrigin,
  readBoundedJson,
} from "@/features/auth/request";
import { apiResponse } from "@/features/auth/guard";
import { accountDestination } from "@/features/auth/onboarding";
import { getAuthProviderSettings } from "@/features/auth/settings";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return apiResponse({ error: "Request origin denied" }, 403);
  const input = authInputSchema.safeParse(await readBoundedJson(request).catch(() => null));
  if (!input.success)
    return apiResponse(
      {
        error:
          "Check your email, password and six-digit verification code. New passwords require 12 characters.",
      },
      400,
    );
  const client = await createSupabaseServerClient();
  if (!client)
    return apiResponse(
      {
        error:
          "Account services are not configured. Please try again when account access is available.",
      },
      503,
    );
  const data = input.data;
  if (data.action === "logout") {
    const { error } = await client.auth.signOut();
    return apiResponse(error ? { error: "Sign out failed" } : { ok: true }, error ? 502 : 200);
  }
  if (data.action === "signup") {
    const settings = await getAuthProviderSettings();
    if (!settings?.emailConfirmation)
      return apiResponse(
        { error: "Email verification is not available. Please try again later." },
        503,
      );
    const result = await client.auth.signUp({
      email: data.email,
      password: data.password,
      options: { emailRedirectTo: `${getRequestOrigin(request)}/auth/callback` },
    });
    if (result.error)
      return apiResponse(
        { error: "Unable to complete account request. Check your details and try again later." },
        result.error.status === 429 ? 429 : 400,
      );
    if (result.data.session || result.data.user?.email_confirmed_at) {
      await client.auth.signOut({ scope: "local" });
      return apiResponse(
        { error: "Email verification is not available. Please try again later." },
        503,
      );
    }
    return apiResponse({ ok: true, confirmationRequired: true });
  }
  if (data.action === "resend_signup") {
    const result = await client.auth.resend({
      type: "signup",
      email: data.email,
      options: { emailRedirectTo: `${getRequestOrigin(request)}/auth/callback` },
    });
    if (result.error)
      return apiResponse(
        { error: "Unable to resend yet. Please wait before trying again." },
        result.error.status === 429 ? 429 : 400,
      );
    return apiResponse({ ok: true, confirmationRequired: true });
  }
  const result =
    data.action === "verify_signup"
      ? await client.auth.verifyOtp({ email: data.email, token: data.code, type: "email" })
      : await client.auth.signInWithPassword({ email: data.email, password: data.password });
  if (result.error)
    return apiResponse(
      {
        error:
          data.action === "verify_signup"
            ? "The code is invalid or expired. Check it or request another code."
            : "Unable to sign in. Check your details and verify your email first.",
      },
      result.error.status === 429 ? 429 : 400,
    );
  if (!result.data.user?.email_confirmed_at || !result.data.session) {
    await client.auth.signOut({ scope: "local" });
    return apiResponse(
      { error: "Verify your email before continuing.", confirmationRequired: true },
      403,
    );
  }
  return apiResponse({
    ok: true,
    confirmationRequired: false,
    next: await accountDestination(client, result.data.user.id),
  });
}
