import { requireAccount, apiResponse, databaseFailure } from "@/features/auth/guard";
import { readBoundedJson } from "@/features/auth/request";
import { libraryInput } from "@/features/trust/schema";
import { z } from "zod";
export async function GET(request: Request) {
  const auth = await requireAccount();
  if (auth.response) return auth.response;
  const params = new URL(request.url).searchParams;
  const videoId = params.get("videoId");
  const creatorId = params.get("creatorId");
  if (
    (videoId && !z.uuid().safeParse(videoId).success) ||
    (creatorId && !z.uuid().safeParse(creatorId).success)
  )
    return apiResponse({ error: "Invalid activity target" }, 400);
  let signalQuery = auth.client
    .from("video_signals")
    .select("video_id,signal")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(1000);
  let followQuery = auth.client
    .from("creator_follows")
    .select("creator_id")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (videoId) signalQuery = signalQuery.eq("video_id", videoId);
  if (creatorId) followQuery = followQuery.eq("creator_id", creatorId);
  const [fusions, signals, follows] = await Promise.all([
    auth.client
      .from("saved_fusions")
      .select("id,name,query,updated_at")
      .eq("owner_id", auth.user.id)
      .order("updated_at", { ascending: false })
      .limit(20),
    signalQuery,
    followQuery,
  ]);
  const error = fusions.error || signals.error || follows.error;
  return error
    ? databaseFailure(error)
    : apiResponse({ fusions: fusions.data, signals: signals.data, follows: follows.data });
}
export async function POST(request: Request) {
  const auth = await requireAccount(request);
  if (auth.response) return auth.response;
  const input = libraryInput.safeParse(await readBoundedJson(request).catch(() => null));
  if (!input.success)
    return apiResponse({ error: "Check the saved mix or activity details." }, 400);
  const expectedAccount = request.headers.get("x-aiverse-account");
  if (expectedAccount !== null && expectedAccount !== auth.user.id)
    return apiResponse({ error: "Your signed-in account changed. Refresh before saving." }, 409);
  const value = input.data;
  const result =
    value.action === "save_fusion"
      ? await auth.client.rpc("save_fusion", {
          filter_id: value.id,
          name: value.name,
          query: value.query,
        })
      : value.action === "delete_fusion"
        ? await auth.client.rpc("delete_saved_fusion", { filter_id: value.id })
        : value.action === "signal"
          ? await auth.client.rpc("set_video_signal", {
              video_id: value.videoId,
              signal: value.signal,
              enabled: value.enabled,
            })
          : value.action === "follow"
            ? await auth.client.rpc("set_creator_follow", {
                creator_id: value.creatorId,
                enabled: value.enabled,
              })
            : await auth.client.rpc("record_watch_completion", {
                video_id: value.videoId,
                session_key: value.sessionKey,
                watched_seconds: value.watchedSeconds,
                user_initiated: value.userInitiated,
              });
  return result.error ? databaseFailure(result.error) : apiResponse({ ok: true, id: result.data });
}
