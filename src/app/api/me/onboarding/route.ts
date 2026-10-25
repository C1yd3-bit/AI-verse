import { apiResponse, requireAccount, databaseFailure } from "@/features/auth/guard";
import { readBoundedJson } from "@/features/auth/request";
import { onboardingInputSchema } from "@/features/auth/onboarding";

export async function GET() {
  const auth = await requireAccount();
  if (auth.response) return auth.response;
  if (!auth.user.email_confirmed_at)
    return apiResponse({ error: "Verify your email before continuing.", verified: false }, 403);
  const profile = await auth.client
    .from("account_details")
    .select("full_name,age,contact_number,ethnicity,ethnicity_consent,completed_at")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  const preferences = await auth.client
    .from("viewer_preferences")
    .select("status,genres,regions")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (profile.error || preferences.error)
    return apiResponse({ error: "Could not load onboarding. Please try again." }, 502);
  return apiResponse({
    verified: true,
    profile: profile.data
      ? {
          fullName: profile.data.full_name,
          age: profile.data.age,
          contactNumber: profile.data.contact_number,
          ethnicity: profile.data.ethnicity,
          ethnicityConsent: profile.data.ethnicity_consent,
          completedAt: profile.data.completed_at,
        }
      : null,
    preferences: preferences.data,
    next: profile.data?.completed_at ? "/dashboard" : "/onboarding",
  });
}
export async function POST(request: Request) {
  const auth = await requireAccount(request);
  if (auth.response) return auth.response;
  if (!auth.user.email_confirmed_at)
    return apiResponse({ error: "Verify your email before continuing." }, 403);
  const input = onboardingInputSchema.safeParse(await readBoundedJson(request).catch(() => null));
  if (!input.success)
    return apiResponse(
      { error: "Check your name, age, optional contact number, interests and consent." },
      400,
    );
  const result = await auth.client.rpc("complete_account_onboarding", { payload: input.data });
  return result.error
    ? databaseFailure(result.error)
    : apiResponse({ ok: true, next: "/dashboard" });
}
