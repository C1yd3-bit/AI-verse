import { apiResponse, requireAccount, databaseFailure } from "@/features/auth/guard";
import { readBoundedJson } from "@/features/auth/request";
import { profileInputSchema } from "@/features/profile/schema";
import { readPrivateProfile, updatePrivateProfile } from "@/features/profile/service";

export async function GET() {
  const auth = await requireAccount();
  if (auth.response) return auth.response;
  if (!auth.user.email_confirmed_at)
    return apiResponse({ error: "Verify your email before continuing." }, 403);
  const result = await readPrivateProfile(auth.client, auth.user);
  return result.error
    ? apiResponse({ error: "Could not load your account. Please try again." }, 502)
    : apiResponse(result.data);
}

export async function POST(request: Request) {
  const auth = await requireAccount(request);
  if (auth.response) return auth.response;
  if (!auth.user.email_confirmed_at)
    return apiResponse({ error: "Verify your email before continuing." }, 403);
  const input = profileInputSchema.safeParse(await readBoundedJson(request).catch(() => null));
  if (!input.success)
    return apiResponse({ error: "Check your account information or appearance." }, 400);
  // A different tab can replace the session cookie while this tab still shows
  // the previous account. This is a stale-account check, never an owner selector.
  if (request.headers.get("x-aiverse-account") !== auth.user.id)
    return apiResponse({ error: "Your signed-in account changed. Refresh before saving." }, 409);
  const result = await updatePrivateProfile(auth.client, input.data);
  return result.error ? databaseFailure(result.error) : apiResponse({ ok: true });
}
