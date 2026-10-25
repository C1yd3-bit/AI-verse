import { apiResponse, databaseFailure, requireAccount } from "@/features/auth/guard";
import { ArtworkInputError, artworkBytes, normalizeArtwork } from "@/features/media/artwork";
import { artworkVersionId } from "@/features/media/artwork-schema";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
type Context = { params: Promise<{ versionId: string }> };
async function identity(request: Request, context: Context, mutate = false) {
  const auth = await requireAccount(mutate ? request : undefined);
  if (auth.response) return { response: auth.response };
  if (!auth.user.email_confirmed_at)
    return { response: apiResponse({ error: "Verify your email before continuing." }, 403) };
  if (request.headers.get("x-aiverse-account") !== auth.user.id)
    return {
      response: apiResponse({ error: "Your account changed. Refresh before continuing." }, 409),
    };
  const version = artworkVersionId.safeParse((await context.params).versionId);
  if (!version.success)
    return { response: apiResponse({ error: "This film revision is unavailable." }, 404) };
  return { auth, versionId: version.data };
}
export async function GET(request: Request, context: Context) {
  const result = await identity(request, context);
  if (result.response) return result.response;
  const { auth, versionId } = result;
  const image = await auth.client.rpc("get_version_artwork", { version_id: versionId });
  if (image.error) return databaseFailure(image.error);
  if (image.data !== null && !artworkBytes(image.data))
    return apiResponse({ error: "Thumbnail could not load. Please retry." }, 502);
  return apiResponse({ accountId: auth.user.id, versionId, image: image.data });
}
export async function POST(request: Request, context: Context) {
  const result = await identity(request, context, true);
  if (result.response) return result.response;
  const { auth, versionId } = result;
  // Authorization before decoding prevents unrelated accounts spending decoder work.
  const allowed = await auth.client.rpc("can_edit_version_artwork", { version_id: versionId });
  if (allowed.error) return databaseFailure(allowed.error);
  if (allowed.data !== true)
    return apiResponse(
      { error: "Only the creator's current unuploaded draft can change its thumbnail." },
      403,
    );
  const admin = createSupabaseAdminClient();
  if (!admin) return apiResponse({ error: "Thumbnail storage is not configured." }, 503);
  let image: string;
  try {
    image = await normalizeArtwork(request);
  } catch (error) {
    return error instanceof ArtworkInputError
      ? apiResponse({ error: error.message }, error.status)
      : apiResponse({ error: "Thumbnail could not be read." }, 400);
  }
  const saved = await admin.rpc("set_version_artwork", {
    target_account: auth.user.id,
    version_id: versionId,
    image_data: image,
  });
  return saved.error
    ? databaseFailure(saved.error)
    : apiResponse({ accountId: auth.user.id, versionId, image });
}
