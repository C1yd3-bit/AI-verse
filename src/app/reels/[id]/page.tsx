import type { Metadata } from "next";
import { CatalogUnavailable } from "@/components/catalog-unavailable";
import { notFound } from "next/navigation";
import { ReelViewer } from "@/components/reel-viewer";
import { loadReelViewer } from "@/features/reels/service";
import { toSearchParams } from "@/features/discovery/service";
import "../viewer.css";

export const metadata: Metadata = { title: "Reels" };
export const dynamic = "force-dynamic";

export default async function ReelPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  let data;
  try {
    data = await loadReelViewer(id, toSearchParams(query));
  } catch {
    return <CatalogUnavailable href={`/reels/${encodeURIComponent(id)}`} />;
  }
  if (!data) notFound();
  return <ReelViewer key={`${data.initialId}:${data.backHref}`} initialData={data} />;
}
