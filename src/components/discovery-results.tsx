import Link from "next/link";
import { FilmGrid, EmptyResults, type FilmGridLayout } from "./catalog";
import { discover, nextDiscoveryUrl } from "@/features/discovery/service";
export function DiscoveryResults({
  page,
  path,
  layout = "landscape",
  reelViewerHref,
}: {
  page: Awaited<ReturnType<typeof discover>>;
  path: string;
  layout?: FilmGridLayout;
  reelViewerHref?: string;
}) {
  return (
    <>
      <h2>
        Exact matches <span className="result-count">{page.exact.total}</span>
      </h2>
      {page.exact.items.length ? (
        <FilmGrid videos={page.exact.items} layout={layout} reelViewerHref={reelViewerHref} />
      ) : (
        <EmptyResults />
      )}
      {page.exact.nextCursor && (
        <Link
          className="button secondary"
          href={nextDiscoveryUrl(path, page.query, page.exact.nextCursor)}
        >
          Next films
        </Link>
      )}
      {page.broader.items.length > 0 && (
        <section className="broader-results">
          <h2>Broader suggestions</h2>
          <p className="supporting-note">
            Content inspiration and genre are relaxed here. Your other filters still apply.
          </p>
          <FilmGrid videos={page.broader.items} layout={layout} />
        </section>
      )}
    </>
  );
}
