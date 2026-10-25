"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import { FilmGrid } from "./catalog";
import { isCatalogArtworkPath } from "@/features/discovery/artwork";
const film = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string(),
  creator: z.uuid(),
  format: z.enum(["reel", "movie"]),
  duration: z.number(),
  genres: z.array(z.string()),
  regions: z.array(z.string()),
  languages: z.array(z.string()),
  tags: z.array(z.string()),
  artwork: z.string().max(300).refine(isCatalogArtworkPath),
  status: z.literal("published"),
  demo: z.literal(false),
  publishedAt: z.string().optional(),
});
export function PersonalizedShelf() {
  const [films, setFilms] = useState<z.infer<typeof film>[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/recommendations", { cache: "no-store", signal: controller.signal })
      .then(async (response) =>
        response.ok
          ? z
              .object({ recommendations: z.object({ items: z.array(z.object({ video: film })) }) })
              .parse(await response.json())
              .recommendations.items.map((item) => item.video)
          : null,
      )
      .then((value) => {
        if (!controller.signal.aborted) setFilms(value);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  if (!films?.length) return null;
  return (
    <section className="broader-results">
      <h2>For your interests</h2>
      <p className="supporting-note">
        Based on your saved interests, recent films and activity, with room for something different.
        Change your interests or choose Not Interested on a film to adjust future picks.
      </p>
      <FilmGrid videos={films} />
    </section>
  );
}
