import { z } from "zod";

export const genreSlugs = [
  "fantasy",
  "sci-fi",
  "comedy",
  "horror",
  "animals",
  "action",
  "romance",
  "mystery",
  "anime",
  "history",
  "nature",
  "wholesome",
] as const;
export const regionSlugs = [
  "korean",
  "chinese",
  "filipino",
  "japanese",
  "indian",
  "thai",
  "vietnamese",
  "turkish",
  "american",
  "british",
  "mexican",
  "global",
] as const;
const unique = (values: readonly string[]) => new Set(values).size === values.length;
const genres = z.array(z.enum(genreSlugs)).max(8).refine(unique, "Select each genre only once");
const regions = z
  .array(z.enum(regionSlugs))
  .max(12)
  .refine(unique, "Select each content region only once");
export const preferenceSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("completed"),
      genres: genres.refine((values) => values.length >= 5, "Choose 5–8 genres or skip"),
      regions,
    })
    .strict(),
  z
    .object({
      status: z.literal("skipped"),
      genres: z.array(z.enum(genreSlugs)).length(0),
      regions: z.array(z.enum(regionSlugs)).length(0),
    })
    .strict(),
]);
export type ViewerPreferences = z.infer<typeof preferenceSchema>;
