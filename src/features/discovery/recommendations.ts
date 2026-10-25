import { z } from "zod";
import type { CatalogVideo } from "./catalog";
import { discoveryQuerySchema, type DiscoveryQuery } from "./query";

const weight = z.number().finite().min(0).max(10);
export const recommendationConfigSchema = z
  .object({
    weights: z
      .object({ interest: weight, completion: weight, engagement: weight, freshness: weight })
      .strict(),
    explorationFraction: z.number().finite().min(0).max(0.5),
    maxPerCreator: z.number().int().min(1).max(10),
    limit: z.number().int().min(1).max(50),
  })
  .strict();
export type RecommendationConfig = z.infer<typeof recommendationConfigSchema>;
// Explicit initial hypotheses, not measured effects or evidence-based weights.
export const initialRecommendationConfig: RecommendationConfig = {
  weights: { interest: 0.45, completion: 0.25, engagement: 0.15, freshness: 0.15 },
  explorationFraction: 0.2,
  maxPerCreator: 2,
  limit: 20,
};
const ids = z.array(z.string().min(1).max(200)).max(5000).default([]);
const watchSchema = z
  .object({
    eventId: z.string().min(1).max(200),
    videoId: z.string().min(1).max(200),
    watchedSeconds: z.number().finite().min(0).max(10800),
    durationSeconds: z.number().finite().positive().max(10800),
    userInitiated: z.boolean(),
    autoplay: z.boolean(),
    suspectedBot: z.boolean(),
  })
  .strict();
export type RecommendationWatchSignal = z.infer<typeof watchSchema>;
const contextSchema = z
  .object({
    interests: discoveryQuerySchema,
    seenVideoIds: ids,
    notInterestedVideoIds: ids,
    blockedCreatorIds: ids,
    likedVideoIds: ids,
    followedCreatorIds: ids,
    watches: z.array(watchSchema).max(5000).default([]),
    now: z.number().finite().nonnegative(),
    // Supplied by the catalog adapter, not inferred from client events.
    publishedAt: z.record(z.string(), z.number().finite().nonnegative()).default({}),
    seed: z.string().min(1).max(100),
  })
  .strict();
export type RecommendationContext = Omit<z.input<typeof contextSchema>, "interests"> & {
  interests: DiscoveryQuery;
};

function hash(input: string): number {
  let result = 2166136261;
  for (const char of input) {
    result ^= char.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

/** Requires trusted, server-validated, owner-scoped signals. These flags alone
 * cannot prove a client is human: ingestion must rate-limit/dedupe/verify session.
 * Completion learns content affinity from history, never global view counts. */
export function rankRecommendations(
  catalog: readonly CatalogVideo[],
  input: RecommendationContext,
  inputConfig: RecommendationConfig = initialRecommendationConfig,
) {
  const context = contextSchema.parse(input);
  const config = recommendationConfigSchema.parse(inputConfig);
  if (Object.values(config.weights).every((value) => value === 0))
    throw new Error("At least one recommendation weight must be positive");
  const byId = new Map(
    catalog.filter((video) => video.status === "published").map((video) => [video.id, video]),
  );
  const excluded = new Set([...context.seenVideoIds, ...context.notInterestedVideoIds]);
  const notInterested = new Set(context.notInterestedVideoIds);
  const blocked = new Set(context.blockedCreatorIds);
  const likes = new Set(context.likedVideoIds);
  const follows = new Set(context.followedCreatorIds);
  const perVideoCompletion = new Map<string, number>();
  const eventIds = new Set<string>();
  for (const watch of context.watches) {
    if (eventIds.has(watch.eventId)) continue;
    eventIds.add(watch.eventId);
    const source = byId.get(watch.videoId);
    if (
      !source ||
      !watch.userInitiated ||
      watch.autoplay ||
      watch.suspectedBot ||
      notInterested.has(source.id) ||
      blocked.has(source.creator)
    )
      continue;
    // Trust actual catalog duration, reject spoofed duration denominators. Each
    // source contributes at most one completion no matter how many events recur.
    if (Math.abs(watch.durationSeconds - source.duration) > 1 || source.duration <= 0) continue;
    const completion = Math.min(1, watch.watchedSeconds / source.duration);
    perVideoCompletion.set(source.id, Math.max(perVideoCompletion.get(source.id) ?? 0, completion));
  }
  const affinities = new Map<string, { sum: number; count: number }>();
  for (const [videoId, completion] of perVideoCompletion) {
    const video = byId.get(videoId)!;
    for (const genre of new Set(video.genres)) {
      const previous = affinities.get(genre) ?? { sum: 0, count: 0 };
      affinities.set(genre, { sum: previous.sum + completion, count: previous.count + 1 });
    }
  }
  const weightsTotal = Object.values(config.weights).reduce((sum, value) => sum + value, 0);
  const scored = [...byId.values()]
    .filter((video) => !excluded.has(video.id) && !blocked.has(video.creator))
    .map((video) => {
      const overlap = (selected: string[], actual: string[]) =>
        selected.length
          ? selected.filter((value) => actual.includes(value)).length / selected.length
          : 0;
      const dimensions = [
        [context.interests.genres, video.genres],
        [context.interests.regions, video.regions],
        [context.interests.languages, video.languages],
        [context.interests.hashtags, video.tags],
        [context.interests.formats, [video.format]],
      ].filter(([selected]) => selected.length);
      const interest = dimensions.length
        ? dimensions.reduce((sum, [selected, actual]) => sum + overlap(selected, actual), 0) /
          dimensions.length
        : 0;
      const completion = video.genres.length
        ? video.genres.reduce((sum, genre) => {
            const affinity = affinities.get(genre);
            return sum + (affinity ? affinity.sum / affinity.count : 0);
          }, 0) / video.genres.length
        : 0;
      const engagement = (Number(likes.has(video.id)) + Number(follows.has(video.creator))) / 2;
      const publishedAt = context.publishedAt[video.id];
      const freshness =
        publishedAt === undefined || publishedAt > context.now
          ? 0
          : Math.max(0, 1 - (context.now - publishedAt) / (30 * 86400000));
      const factors = { interest, completion, engagement, freshness };
      const score =
        Object.entries(factors).reduce(
          (sum, [key, value]) => sum + config.weights[key as keyof typeof factors] * value,
          0,
        ) / weightsTotal;
      return {
        video,
        score,
        factors,
        allocation: "personalized" as "personalized" | "exploration",
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score || (a.video.id < b.video.id ? -1 : a.video.id > b.video.id ? 1 : 0),
    );
  const creatorCounts = new Map<string, number>();
  const selectedIds = new Set<string>();
  const output: typeof scored = [];
  const take = (
    candidates: typeof scored,
    count: number,
    allocation: "personalized" | "exploration",
  ) => {
    let added = 0;
    for (const item of candidates) {
      if (added >= count || output.length >= config.limit) break;
      const creator = item.video.creator;
      if (
        selectedIds.has(item.video.id) ||
        (creatorCounts.get(creator) ?? 0) >= config.maxPerCreator
      )
        continue;
      creatorCounts.set(creator, (creatorCounts.get(creator) ?? 0) + 1);
      selectedIds.add(item.video.id);
      output.push({ ...item, allocation });
      added++;
    }
  };
  const explorationSlots = Math.floor(config.limit * config.explorationFraction);
  take(scored, config.limit - explorationSlots, "personalized");
  // Stable seeded order avoids nondeterministic rerenders. Exploration is drawn
  // from actual remaining eligible records, still honoring negative feedback.
  take(
    [...scored].sort(
      (a, b) =>
        hash(`${context.seed}:${a.video.id}`) - hash(`${context.seed}:${b.video.id}`) ||
        a.video.id.localeCompare(b.video.id),
    ),
    explorationSlots,
    "exploration",
  );
  take(scored, config.limit - output.length, "personalized");
  return {
    items: output,
    proposedExplorationFraction: config.explorationFraction,
    actualExplorationFraction: output.length
      ? output.filter((item) => item.allocation === "exploration").length / output.length
      : 0,
    note: "Weights and exploration are initial hypotheses; no retention improvement has been established.",
  };
}
