import { requireAccount, apiResponse, databaseFailure } from "@/features/auth/guard";
export async function GET(request: Request) {
  const auth = await requireAccount();
  if (auth.response) return auth.response;
  // Comparison only: verified cookie identity and SQL authorization remain authoritative.
  const expectedAccount = request.headers.get("x-aiverse-account");
  if (expectedAccount !== null && expectedAccount !== auth.user.id)
    return apiResponse({ error: "Your signed-in account changed. Refresh the studio." }, 409);
  if (!auth.user.email_confirmed_at)
    return apiResponse({ error: "Verify your email before opening the studio." }, 403);
  const [eligibility, videos] = await Promise.all([
    auth.client.rpc("can_upload_media"),
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
  const error = eligibility.error || videos.error || versions.error;
  if (error) return databaseFailure(error);
  if (typeof eligibility.data !== "boolean")
    return apiResponse({ error: "Studio access could not be checked. Try again." }, 503);
  return apiResponse({
    eligible: eligibility.data,
    videos: videos.data,
    versions: versions.data,
  });
}
