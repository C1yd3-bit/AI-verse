import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Sparkles, Film } from "lucide-react";
import { type CatalogVideo, durationLabel, label } from "@/features/discovery/catalog";
import { genreSlugs, regionSlugs } from "@/features/preferences/schema";

export function FilmMeta({ video }: { video: CatalogVideo }) {
  return (
    <p className="film-meta">
      <span>{label(video.genres[0] ?? "film")}</span>
      <span>
        {video.regions[0] === "global"
          ? "Global inspiration"
          : video.regions[0]
            ? `${label(video.regions[0])}-inspired`
            : "Any inspiration"}
      </span>
      <span>{durationLabel(video.duration)}</span>
      <span>AI-created</span>
    </p>
  );
}
export type FilmGridLayout = "landscape" | "portrait";

export function FilmGrid({
  videos,
  layout = "landscape",
  reelViewerHref,
}: {
  videos: CatalogVideo[];
  layout?: FilmGridLayout;
  reelViewerHref?: string;
}) {
  return (
    <div className={`film-grid${layout === "portrait" ? " film-grid-portrait" : ""}`}>
      {videos.map((video, index) => (
        <article className="film-item" key={video.id}>
          <Link
            href={
              reelViewerHref
                ? `/reels/${encodeURIComponent(video.id)}${reelViewerHref.slice("/reels".length)}`
                : `/watch/${video.id}`
            }
            prefetch={reelViewerHref ? false : undefined}
            className="film-art"
            aria-label={`${reelViewerHref ? "Open reel" : "View details for"} ${video.title}`}
          >
            {video.artwork ? (
              <Image
                loading={index === 0 ? "eager" : "lazy"}
                src={video.artwork}
                unoptimized
                alt={`Thumbnail for ${video.title}`}
                fill
                sizes={
                  layout === "portrait"
                    ? "(max-width: 700px) 45vw, (max-width: 1199px) 28vw, (max-width: 1599px) 21vw, 18vw"
                    : "(max-width: 700px) 100vw, (max-width: 1050px) 40vw, 28vw"
                }
                style={layout === "portrait" ? { objectPosition: "center" } : undefined}
              />
            ) : (
              <span className="film-placeholder">
                <Film size={32} aria-hidden="true" />
                <span>{video.title}</span>
              </span>
            )}
          </Link>
          <h3>
            <Link
              href={
                reelViewerHref
                  ? `/reels/${encodeURIComponent(video.id)}${reelViewerHref.slice("/reels".length)}`
                  : `/watch/${video.id}`
              }
              prefetch={reelViewerHref ? false : undefined}
            >
              {video.title}
            </Link>
          </h3>
          <FilmMeta video={video} />
        </article>
      ))}
    </div>
  );
}
export function FusionForm({
  region = "all",
  genre = "all",
  format = "all",
}: {
  region?: string;
  genre?: string;
  format?: string;
}) {
  return (
    <form action="/fusion" className="fusion-bar">
      <div className="fusion-heading">
        <Sparkles size={31} aria-hidden="true" />
        <div>
          <h2>Fusion</h2>
          <p>Create a mix inspired by what you love</p>
        </div>
      </div>
      <label>
        Content inspiration
        <select name="region" defaultValue={region}>
          <option value="all">Any inspiration</option>
          {regionSlugs.map((r) => (
            <option key={r} value={r}>
              {r === "global" ? "Global / any" : label(r)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Genre
        <select name="genre" defaultValue={genre}>
          <option value="all">Any genre</option>
          {genreSlugs.map((g) => (
            <option key={g} value={g}>
              {label(g)}
            </option>
          ))}
        </select>
      </label>
      <label>
        Format
        <select name="format" defaultValue={format}>
          <option value="all">All formats</option>
          <option value="reels">Reels</option>
          <option value="movies">Movies</option>
        </select>
      </label>
      <button type="submit" className="button primary">
        <Sparkles size={18} aria-hidden="true" />
        Find my mix
      </button>
    </form>
  );
}
export function EmptyResults({
  message = "No exact matches in the current catalog.",
}: {
  message?: string;
}) {
  return (
    <div className="empty-results">
      <Sparkles size={28} aria-hidden="true" />
      <h2>A different mix is waiting.</h2>
      <p>{message} Try another genre or content inspiration.</p>
      <Link className="button secondary" href="/fusion?region=all&genre=all&format=all">
        Explore the catalog
        <ArrowRight size={16} aria-hidden="true" />
      </Link>
    </div>
  );
}
