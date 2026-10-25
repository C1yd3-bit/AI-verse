import { z } from "zod";
import { genreSlugs, regionSlugs } from "@/features/preferences/schema";
import { languageSlugs } from "@/features/discovery/query";
import { MAX_UPLOAD_BYTES } from "./policy";

const unique = (items: string[]) => new Set(items).size === items.length;
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const slugs = z
  .array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/))
  .max(10)
  .refine(unique);
export const versionInput = z
  .object({
    videoId: z.uuid().nullable(),
    metadata: z
      .object({
        title: text(1, 160),
        description: text(1, 3000),
        format: z.enum(["reel", "movie"]),
        genres: z.array(z.enum(genreSlugs)).min(1).max(12).refine(unique),
        regions: z.array(z.enum(regionSlugs)).min(1).max(12).refine(unique),
        languages: z.array(z.enum(languageSlugs)).min(1).max(12).refine(unique),
        tags: slugs,
        ai_disclosed: z.literal(true),
        rights_attested: z.literal(true),
        rights_declaration: text(20, 1000),
      })
      .strict(),
  })
  .strict();
export const uploadInput = z
  .object({
    versionId: z.uuid(),
    idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,100}$/),
    fileSize: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
  })
  .strict();
export const decisionInput = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("application"),
      id: z.uuid(),
      approve: z.boolean(),
      reason: z.string().trim().min(5).max(1000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("version"),
      id: z.uuid(),
      approve: z.boolean(),
      reason: z.string().trim().min(5).max(1000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("video"),
      id: z.uuid(),
      action: z.enum(["hide", "remove"]),
      reason: z.string().trim().min(5).max(1000),
    })
    .strict(),
]);
