export type CatalogVideo = {
  id: string;
  title: string;
  description: string;
  creator: string;
  format: "reel" | "movie";
  duration: number;
  genres: string[];
  regions: string[];
  languages: string[];
  tags: string[];
  artwork: string;
  status: "published" | "pending_review";
  demo?: boolean;
  publishedAt?: string;
};

export function durationLabel(seconds: number) {
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}
export function label(slug: string) {
  return slug === "sci-fi" ? "Sci-fi" : slug.charAt(0).toUpperCase() + slug.slice(1);
}
