import type { Metadata } from "next";
import { CatalogUnavailable } from "@/components/catalog-unavailable";
import { DiscoveryResults } from "@/components/discovery-results";
import { discover, toSearchParams } from "@/features/discovery/service";
import { createReelQuery, reelBackHref } from "@/features/reels/schema";
import { serializeDiscoveryQuery } from "@/features/discovery/query";
import "./reels.css";
export const metadata: Metadata = { title: "Reels" };
export default async function Reels({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = toSearchParams(await searchParams);
  const query = createReelQuery(params);
  const canonical = serializeDiscoveryQuery(query);
  if (params.has("cursor")) canonical.set("cursor", params.get("cursor")!);
  if (params.has("limit")) canonical.set("limit", params.get("limit")!);
  let page;
  try {
    page = await discover(canonical);
  } catch {
    return <CatalogUnavailable href="/reels" />;
  }
  return (
    <section className="page-content reels-page">
      <h1>Small stories. Entire worlds.</h1>
      <p className="page-intro">Explore approved AI-created reels.</p>
      <DiscoveryResults
        page={page}
        path="/reels"
        layout="portrait"
        reelViewerHref={reelBackHref(query, params)}
      />
    </section>
  );
}
