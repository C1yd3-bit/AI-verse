import { requireAccount, apiResponse, databaseFailure } from "@/features/auth/guard";
export async function GET(request: Request) {
  const auth = await requireAccount();
  if (auth.response) return auth.response;
  // Comparison only: the verified cookie remains the source of identity.
  const expectedAccount = request.headers.get("x-aiverse-account");
  if (expectedAccount !== null && expectedAccount !== auth.user.id)
    return apiResponse({ error: "Your signed-in account changed. Refresh the review queue." }, 409);
  const roleResult = await auth.client
    .from("user_roles")
    .select("role")
    .eq("user_id", auth.user.id);
  if (roleResult.error) return databaseFailure(roleResult.error);
  const roles = roleResult.data.map((value) => value.role);
  if (!roles.includes("moderator") && !roles.includes("admin"))
    return apiResponse({ error: "Moderator access required" }, 403);
  const [versions, applications] = await Promise.all([
    auth.client
      .from("video_versions")
      .select("id,video_id,revision,metadata,state,duration_seconds,created_at")
      .eq("state", "pending_review")
      .order("created_at")
      .limit(50),
    roles.includes("admin")
      ? auth.client
          .from("creator_applications")
          .select("id,user_id,application,status,created_at")
          .eq("status", "pending")
          .order("created_at")
          .limit(50)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const error = versions.error || applications.error;
  return error
    ? databaseFailure(error)
    : apiResponse({ versions: versions.data, applications: applications.data, roles });
}
