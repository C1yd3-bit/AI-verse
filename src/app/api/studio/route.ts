import { requireAccount, apiResponse, databaseFailure } from "@/features/auth/guard";
export async function GET(request: Request) {
  const auth = await requireAccount();
  if (auth.response) return auth.response;
  // Comparison only: verified cookie identity and SQL authorization remain authoritative.
  const expectedAccount = request.headers.get("x-aiverse-account");
  if (expectedAccount !== null && expectedAccount !== auth.user.id)
    return apiResponse({ error: "Your signed-in account changed. Refresh the studio." }, 409);
  const [roles, videos] = await Promise.all([
    auth.client.from("user_roles").select("role").eq("user_id", auth.user.id),
    auth.client
      .from("videos")
      .select("id,state,latest_version_id,active_version_id,created_at")
      .eq("owner_id", auth.user.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const ids = videos.data?.map((video) => video.id) ?? [];
  const versions = ids.length
    ? await auth.client
        .from("video_versions")
        .select("id,video_id,revision,metadata,state,duration_seconds,created_at")
        .in("video_id", ids)
        .order("created_at", { ascending: false })
        .limit(100)
    : { data: [], error: null };
  const error = roles.error || videos.error || versions.error;
  if (error) return databaseFailure(error);
  return apiResponse({
    roles: roles.data?.map((role) => role.role),
    videos: videos.data,
    versions: versions.data,
  });
}
