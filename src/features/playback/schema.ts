import { z } from "zod";
import { MAX_MOVIE_SECONDS } from "@/features/media/policy";

export const playbackProgressInput = z
  .object({
    sessionKey: z.uuid(),
    watchedSeconds: z.number().int().min(1).max(MAX_MOVIE_SECONDS),
  })
  .strict();

export const playbackTrackingSchema = z
  .object({
    sessionKey: z.uuid(),
    accountId: z.uuid(),
    versionId: z.uuid(),
  })
  .strict();

export const playbackProgressResult = z
  .object({
    watchedSeconds: z.number().int().min(1).max(MAX_MOVIE_SECONDS),
    credited: z.boolean(),
  })
  .strict();

export type PlaybackTracking = z.infer<typeof playbackTrackingSchema>;
