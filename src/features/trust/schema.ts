import { z } from "zod";
import { MAX_MOVIE_SECONDS } from "@/features/media/policy";
import { discoveryQuerySchema } from "@/features/discovery/query";
const reason = z.string().trim().min(5).max(1000);
export const libraryInput = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("save_fusion"),
      id: z.uuid().nullable(),
      name: z.string().trim().min(1).max(80),
      query: discoveryQuerySchema,
    })
    .strict(),
  z.object({ action: z.literal("delete_fusion"), id: z.uuid() }).strict(),
  z
    .object({
      action: z.literal("signal"),
      videoId: z.uuid(),
      signal: z.enum(["like", "not_interested"]),
      enabled: z.boolean(),
    })
    .strict(),
  z.object({ action: z.literal("follow"), creatorId: z.uuid(), enabled: z.boolean() }).strict(),
  z
    .object({
      action: z.literal("watch"),
      videoId: z.uuid(),
      sessionKey: z.uuid(),
      watchedSeconds: z.number().int().min(1).max(MAX_MOVIE_SECONDS),
      userInitiated: z.literal(true),
    })
    .strict(),
]);
export const reportInput = z
  .object({
    videoId: z.uuid(),
    category: z.enum(["rights", "harmful", "misleading", "other"]),
    details: z.string().trim().min(5).max(2000),
  })
  .strict();
export const operationInput = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("resolve_report"),
      id: z.uuid(),
      resolution: z.enum(["dismiss", "hide", "remove"]),
      reason,
    })
    .strict(),
  z
    .object({ action: z.literal("suspend"), creatorId: z.uuid(), suspended: z.boolean(), reason })
    .strict(),
  z
    .object({ action: z.literal("resolve_appeal"), id: z.uuid(), approved: z.boolean(), reason })
    .strict(),
  z
    .object({
      action: z.literal("quota"),
      creatorId: z.uuid(),
      dailyUploads: z.number().int().min(1).max(100).nullable(),
      monthlySeconds: z.number().int().min(180).max(86400).nullable(),
      expiresAt: z.iso.datetime().nullable(),
      reason,
    })
    .strict(),
]);
export const appealInput = z
  .object({ suspensionId: z.uuid(), statement: z.string().trim().min(20).max(3000) })
  .strict();
