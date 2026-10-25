import Link from "next/link";
import { CatalogUnavailable } from "@/components/catalog-unavailable";
import { notFound } from "next/navigation";
import { publicCollection } from "@/features/discovery/service";
import { FilmGrid } from "@/components/catalog";
export default async function Tag({
  params,
  searchParams,
}: {
  params: Promise<{ tag: string }>;
  searchParams: Promise<{ after?: string }>;
}) {
  const { tag } = await params;
  const { after } = await searchParams;
  if (!/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,79}$/u.test(tag)) notFound();
  let page;
  try {
    page = await publicCollection({ tag, after });
  } catch {
    return <CatalogUnavailable href={`/tag/${encodeURIComponent(tag)}`} />;
  }
  return (
    <section className="page-content">
      <h1>#{tag}</h1>
      <p className="page-intro">Published films with this tag.</p>
      {page.items.length ? <FilmGrid videos={page.items} /> : <p>No films match this tag.</p>}
      {page.nextId && (
        <Link
          className="button secondary"
          href={`/tag/${encodeURIComponent(tag)}?after=${page.nextId}`}
        >
          Next films
        </Link>
      )}
    </section>
  );
}
