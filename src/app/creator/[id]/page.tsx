import Link from "next/link";
import { CatalogUnavailable } from "@/components/catalog-unavailable";
import { notFound } from "next/navigation";
import { publicCollection } from "@/features/discovery/service";
import { FilmGrid } from "@/components/catalog";
export default async function Creator({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ after?: string }>;
}) {
  const { id } = await params;
  const { after } = await searchParams;
  let page;
  try {
    page = await publicCollection({ creatorId: id, after });
  } catch {
    return <CatalogUnavailable href={`/creator/${encodeURIComponent(id)}`} />;
  }
  if (!page.creator) notFound();
  return (
    <section className="page-content">
      <h1>{page.creator.display_name}</h1>
      <p className="supporting-note">@{page.creator.handle}</p>
      <p className="page-intro">{page.creator.bio}</p>
      {page.items.length ? <FilmGrid videos={page.items} /> : <p>No published films yet.</p>}
      {page.nextId && (
        <Link className="button secondary" href={`/creator/${id}?after=${page.nextId}`}>
          Next films
        </Link>
      )}
    </section>
  );
}
