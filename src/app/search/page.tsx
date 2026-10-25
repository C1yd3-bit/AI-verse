import type { Metadata } from "next";
import { CatalogUnavailable } from "@/components/catalog-unavailable";
import { DiscoveryResults } from "@/components/discovery-results";
import { CatalogUnavailableError, discover, toSearchParams } from "@/features/discovery/service";
export const metadata: Metadata = { title: "Search" };
export default async function Search({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.slice(0, 200) : "";
  let page;
  try {
    page = await discover(toSearchParams(params));
  } catch (error) {
    if (error instanceof CatalogUnavailableError) return <CatalogUnavailable href="/search" />;
    return (
      <section className="page-content">
        <h1>Check your search.</h1>
        <p className="error-message" role="alert">
          Try simpler keywords or start a new search. The catalog may have changed since your last
          page.
        </p>
      </section>
    );
  }
  return (
    <section className="page-content">
      <h1>{query ? `Results for “${query}”` : "Find your next world."}</h1>
      <p className="page-intro">
        Search titles, descriptions and tags, or try “Korean romantic reels under 2 minutes”.{" "}
        Results come only from approved, published films.
      </p>
      <DiscoveryResults page={page} path="/search" />
    </section>
  );
}
