import type { CatalogVideo } from "../../src/features/discovery/catalog";

// Development fixtures only. They are never inserted into the production catalog.
export const demoCatalog: CatalogVideo[] = [
  {
    id: "somewhere-after-midnight",
    title: "Somewhere, after midnight",
    description: "Two strangers keep almost finding each other on a rain-soaked Seoul street.",
    creator: "AIVerse demo studio",
    format: "reel",
    duration: 134,
    genres: ["romance"],
    regions: ["korean"],
    languages: ["korean"],
    tags: ["rain", "city", "connection"],
    artwork: "/artwork/midnight-v2.png",
    status: "published",
  },
  {
    id: "last-greenhouse",
    title: "The last greenhouse",
    description: "A botanist tends the last garden aboard a station at the edge of space.",
    creator: "AIVerse demo studio",
    format: "movie",
    duration: 178,
    genres: ["sci-fi", "nature"],
    regions: ["global"],
    languages: ["english"],
    tags: ["space", "garden", "hope"],
    artwork: "/artwork/greenhouse-v2.png",
    status: "published",
  },
  {
    id: "one-table-for-two",
    title: "One table for two",
    description: "A tiny cat chef prepares a very big dinner for an unexpected guest.",
    creator: "AIVerse demo studio",
    format: "reel",
    duration: 75,
    genres: ["animals", "comedy", "wholesome"],
    regions: ["global"],
    languages: ["english"],
    tags: ["cat", "cooking", "spaghetti"],
    artwork: "/artwork/cat-v2.png",
    status: "published",
  },
  {
    id: "tides-of-tomorrow",
    title: "Tides of tomorrow",
    description: "An ocean explorer hears a signal from a moon that should be silent.",
    creator: "AIVerse demo studio",
    format: "movie",
    duration: 156,
    genres: ["sci-fi", "mystery"],
    regions: ["global"],
    languages: ["english"],
    tags: ["ocean", "moon", "future"],
    artwork: "/artwork/tides-v2.png",
    status: "published",
  },
  {
    id: "unreviewed-demo",
    title: "Private processing example",
    description: "This fixture proves nonpublished rows cannot appear in demo discovery.",
    creator: "AIVerse demo studio",
    format: "reel",
    duration: 45,
    genres: ["horror"],
    regions: ["filipino"],
    languages: ["tagalog"],
    tags: ["private"],
    artwork: "/artwork/tides-v2.png",
    status: "pending_review",
  },
];

export type DiscoveryFilters = { query?: string; region?: string; genre?: string; format?: string };
export function searchDemoCatalog(
  filters: DiscoveryFilters,
  catalog: CatalogVideo[] = demoCatalog,
): CatalogVideo[] {
  const terms = (filters.query ?? "").toLowerCase().trim().split(/\s+/).filter(Boolean);
  return catalog.filter((video) => {
    if (video.status !== "published") return false;
    if (
      filters.region &&
      !["all", "global"].includes(filters.region) &&
      !video.regions.includes(filters.region)
    )
      return false;
    if (filters.genre && filters.genre !== "all" && !video.genres.includes(filters.genre))
      return false;
    if (
      filters.format &&
      filters.format !== "all" &&
      video.format !== ({ reels: "reel", movies: "movie" }[filters.format] ?? filters.format)
    )
      return false;
    const text = [
      video.title,
      video.description,
      ...video.tags,
      ...video.genres,
      ...video.regions,
      ...video.languages,
    ]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
