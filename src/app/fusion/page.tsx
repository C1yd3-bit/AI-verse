import type { Metadata } from "next";
import { CatalogUnavailable } from "@/components/catalog-unavailable";
import { FusionForm } from "@/components/catalog";
import { DiscoveryResults } from "@/components/discovery-results";
import { FusionFilters } from "@/components/fusion-filters";
import { SavedFusion } from "@/components/saved-fusion";
import { CatalogUnavailableError, discover, toSearchParams } from "@/features/discovery/service";
export const metadata: Metadata = { title: "Fusion" };
export default async function Fusion({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let page;
  try {
    page = await discover(toSearchParams(await searchParams));
  } catch (error) {
    if (error instanceof CatalogUnavailableError) return <CatalogUnavailable href="/fusion" />;
    return (
      <section className="page-content">
        <h1>Start a fresh combination.</h1>
        <p className="error-message" role="alert">
          Check your filters or start again after the catalog changes.
        </p>
        <a className="button secondary" href="/fusion">
          Reset filters
        </a>
      </section>
    );
  }
  const { query } = page;
  return (
    <>
      <section className="page-content page-heading">
        <h1>Your taste. A new combination.</h1>
        <p className="page-intro">
          Mix content inspiration, genre and format. Cultural interests describe the stories you
          enjoy, never your personal ethnicity.
        </p>
      </section>
      {![query.regions, query.genres, query.formats, query.languages].some(
        (values) => values.length > 1,
      ) && (
        <FusionForm
          key={JSON.stringify(query)}
          region={query.regions[0] ?? "all"}
          genre={query.genres[0] ?? "all"}
          format={
            query.formats[0] === "reel" ? "reels" : query.formats[0] === "movie" ? "movies" : "all"
          }
        />
      )}
      <section className="shelf">
        <FusionFilters query={query} />
        <SavedFusion query={query} />
        <DiscoveryResults page={page} path="/fusion" />
      </section>
    </>
  );
}
