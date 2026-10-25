import { apiResponse, databaseFailure, requireAccount } from "@/features/auth/guard";
import { AvatarInputError, normalizeAvatar, readAvatar } from "@/features/profile/avatar";

export const runtime = "nodejs";

function staleAccount(request: Request, accountId: string) {
  return request.headers.get("x-aiverse-account") !== accountId
    ? apiResponse({ error: "Your signed-in account changed. Refresh before continuing." }, 409)
    : null;
}

export async function GET(request: Request) {
  const auth = await requireAccount();
  if (auth.response) return auth.response;
  if (!auth.user.email_confirmed_at)
    return apiResponse({ error: "Verify your email before continuing." }, 403);
  const stale = staleAccount(request, auth.user.id);
  if (stale) return stale;
  const result = await readAvatar(auth.client);
  return result.error
    ? apiResponse({ error: "Could not load your photo. Please try again." }, 502)
    : apiResponse({ accountId: auth.user.id, image: result.data });
}

export async function POST(request: Request) {
  const auth = await requireAccount(request);
  if (auth.response) return auth.response;
  if (!auth.user.email_confirmed_at)
    return apiResponse({ error: "Verify your email before continuing." }, 403);
  const stale = staleAccount(request, auth.user.id);
  if (stale) return stale;
  let image: string;
  try {
    image = await normalizeAvatar(request);
  } catch (error) {
    return error instanceof AvatarInputError
      ? apiResponse({ error: error.message }, error.status)
      : apiResponse({ error: "Could not read your photo. Please try again." }, 400);
  }
  const result = await auth.client.rpc("set_my_avatar", { photo_data: image });
  return result.error
    ? databaseFailure(result.error)
    : apiResponse({ accountId: auth.user.id, image });
}
