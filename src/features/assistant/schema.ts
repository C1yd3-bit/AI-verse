import { z } from "zod";
import { isCatalogArtworkPath } from "@/features/discovery/artwork";
import {
  discoveryQuerySchema,
  parseDiscoveryParams,
  serializeDiscoveryQuery,
  languageSlugs,
} from "@/features/discovery/query";
import { genreSlugs, regionSlugs } from "@/features/preferences/schema";

const safeId = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/);

export const assistantInputSchema = z
  .object({
    message: z.string().trim().min(1).max(500),
    context: discoveryQuerySchema.optional(),
    referenceVideoId: safeId.optional(),
  })
  .strict();
export type AssistantInput = z.infer<typeof assistantInputSchema>;
const publicVideoSchema = z
  .object({
    id: safeId,
    title: z.string().min(1).max(500),
    description: z.string().max(10000),
    creator: z.string().min(1).max(200),
    format: z.enum(["reel", "movie"]),
    duration: z.number().int().min(1).max(10800),
    genres: z.array(z.enum(genreSlugs)).max(12),
    regions: z.array(z.enum(regionSlugs)).max(12),
    languages: z.array(z.enum(languageSlugs)).max(languageSlugs.length),
    tags: z.array(z.string().min(1).max(80)).max(32),
    artwork: z.string().max(300).refine(isCatalogArtworkPath, "Expected a local artwork path"),
    status: z.literal("published"),
    demo: z.boolean().optional(),
    publishedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
const assistantResultSchema = z
  .object({ video: publicVideoSchema, reason: z.string().min(1).max(2000) })
  .strict();
const localDiscoveryUrl = (path: "/fusion" | "/search") =>
  z
    .string()
    .max(4120)
    .refine((value) => {
      if (value === path) return true;
      if (!value.startsWith(`${path}?`) || value.includes("#")) return false;
      try {
        const params = new URLSearchParams(value.slice(path.length + 1));
        return `${path}?${serializeDiscoveryQuery(parseDiscoveryParams(params))}` === value;
      } catch {
        return false;
      }
    }, "Expected a canonical local discovery URL");
export const assistantResponseSchema = z
  .object({
    mode: z.enum(["demo", "live"]),
    query: discoveryQuerySchema,
    reply: z.string().min(1).max(1000),
    filters: z
      .array(
        z.object({ label: z.string().min(1).max(80), value: z.string().min(1).max(3000) }).strict(),
      )
      .max(8),
    exact: z
      .object({
        total: z.number().int().nonnegative(),
        items: z.array(assistantResultSchema).max(3),
      })
      .strict(),
    broader: z
      .object({ label: z.string().min(1).max(200), items: z.array(assistantResultSchema).max(2) })
      .strict(),
    fusionUrl: localDiscoveryUrl("/fusion"),
    searchUrl: localDiscoveryUrl("/search"),
    clarification: z.boolean().optional(),
  })
  .strict()
  .superRefine((response, ctx) => {
    let query: string;
    try {
      query = serializeDiscoveryQuery(response.query).toString();
    } catch {
      ctx.addIssue({ code: "custom", path: ["query"], message: "Discovery filters are too long" });
      return;
    }
    for (const path of ["fusion", "search"] as const) {
      if (response[`${path}Url`] !== `/${path}${query ? `?${query}` : ""}`)
        ctx.addIssue({
          code: "custom",
          path: [`${path}Url`],
          message: "URL must preserve the returned query",
        });
    }
    const items = [...response.exact.items, ...response.broader.items];
    if (
      new Set(items.map((item) => item.video.id)).size !== items.length ||
      response.exact.total < response.exact.items.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Results must be unique and counts must include displayed exact cards",
      });
    if (response.mode === "live" && items.some((item) => item.video.demo === true))
      ctx.addIssue({ code: "custom", message: "Live responses cannot contain demo records" });
  });
export type AssistantResult = z.infer<typeof assistantResultSchema>;
export type AssistantResponse = z.infer<typeof assistantResponseSchema>;
