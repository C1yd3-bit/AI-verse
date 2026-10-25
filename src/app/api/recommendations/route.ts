import { requireAccount, apiResponse, databaseFailure } from "@/features/auth/guard";
import { catalogMode, discover, nextDiscoveryUrl } from "@/features/discovery/service";
import { discoveryQuerySchema } from "@/features/discovery/query";
import {
  rankRecommendations,
  initialRecommendationConfig,
} from "@/features/discovery/recommendations";
import type { CatalogVideo } from "@/features/discovery/catalog";
export async function GET() {
  const auth = await requireAccount();
  if (auth.response) return auth.response;
  if (catalogMode() !== "live")
    return apiResponse(
      { error: "Personalized playback discovery requires the published catalog." },
      503,
    );
  const [preferences, signals, follows, watches] = await Promise.all([
    auth.client
      .from("viewer_preferences")
      .select("genres,regions")
      .eq("user_id", auth.user.id)
      .maybeSingle(),
    auth.client
      .from("video_signals")
      .select("video_id,signal")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false })
      .limit(5000),
    auth.client
      .from("creator_follows")
      .select("creator_id")
      .eq("user_id", auth.user.id)
      .limit(5000),
    auth.client
      .from("watch_completions")
      .select("session_key,video_id,watched_seconds,duration_seconds,user_initiated")
      .eq("user_id", auth.user.id)
      .eq("credited", true)
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);
  const error = preferences.error || signals.error || follows.error || watches.error;
  if (error) return databaseFailure(error);
  try {
    const candidates: CatalogVideo[] = [];
    let params = new URLSearchParams({ limit: "50" });
    // A bounded first-500 candidate pool, not a claim to rank an unlimited corpus.
    for (let page = 0; page < 10; page++) {
      const result = await discover(params);
      candidates.push(...result.exact.items);
      if (!result.exact.nextCursor) break;
      params = new URL(
        nextDiscoveryUrl("/api/catalog", result.query, result.exact.nextCursor),
        "http://local",
      ).searchParams;
      params.set("limit", "50");
    }
    const interested = discoveryQuerySchema.parse({
      genres: preferences.data?.genres ?? [],
      regions: preferences.data?.regions ?? [],
    });
    const context = {
      interests: interested,
      seenVideoIds: watches.data?.map((item) => item.video_id) ?? [],
      notInterestedVideoIds:
        signals.data
          ?.filter((item) => item.signal === "not_interested")
          .map((item) => item.video_id) ?? [],
      blockedCreatorIds: [],
      likedVideoIds:
        signals.data?.filter((item) => item.signal === "like").map((item) => item.video_id) ?? [],
      followedCreatorIds: follows.data?.map((item) => item.creator_id) ?? [],
      watches:
        watches.data?.map((item) => ({
          eventId: item.session_key,
          videoId: item.video_id,
          watchedSeconds: item.watched_seconds,
          durationSeconds: item.duration_seconds,
          userInitiated: item.user_initiated,
          autoplay: false,
          suspectedBot: false,
        })) ?? [],
      now: Date.now(),
      publishedAt: Object.fromEntries(
        candidates
          .filter((video) => video.publishedAt && Number.isFinite(Date.parse(video.publishedAt)))
          .map((video) => [video.id, Date.parse(video.publishedAt!)]),
      ),
      seed: `${auth.user.id}:${new Date().toISOString().slice(0, 10)}`,
    };
    return apiResponse({
      recommendations: rankRecommendations(candidates, context),
      config: initialRecommendationConfig,
      candidateCount: candidates.length,
      explanation:
        "Initial configurable ranking hypotheses. Completed videos and Not Interested are excluded; the candidate pool is capped at 500 published films. Client watch signals are bounded and deduplicated; they are not proof of human attention.",
    });
  } catch {
    return apiResponse(
      { error: "Recommendations unavailable. Browse the published catalog." },
      503,
    );
  }
}
