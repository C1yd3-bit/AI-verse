import type { Metadata } from "next";
import { CatalogUnavailable } from "@/components/catalog-unavailable";
import { DiscoveryResults } from "@/components/discovery-results";
import { discover, toSearchParams } from "@/features/discovery/service";
export const metadata: Metadata = { title: "Movies" };
export default async function Movies({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = toSearchParams(await searchParams);
  params.set("format", "movie");
  let page;
  try {
    page = await discover(params);
  } catch {
    return <CatalogUnavailable href="/movies" />;
  }
  return (
    <section className="page-content">
      <h1>Stay a little longer.</h1>
      <p className="page-intro">A home for approved AI-created short films.</p>
      <DiscoveryResults page={page} path="/movies" />
    </section>
  );
}
