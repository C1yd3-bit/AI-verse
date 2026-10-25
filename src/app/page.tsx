import { FilmGrid, FusionForm } from "@/components/catalog";
import { CatalogUnavailable } from "@/components/catalog-unavailable";
import { discover } from "@/features/discovery/service";
import { PersonalizedShelf } from "@/components/personalized-shelf";

export default async function Home() {
  let page;
  try {
    page = await discover(new URLSearchParams());
  } catch {
    return <CatalogUnavailable />;
  }
  return (
    <>
      <section className="page-content page-heading">
        <h1>Your next world is waiting.</h1>
        <p className="page-intro">AI-created reels and short films, reviewed before publication.</p>
      </section>
      <FusionForm region="all" genre="all" format="all" />
      <section className="shelf">
        <h2>Explore published films</h2>
        {page.exact.items.length ? (
          <FilmGrid videos={page.exact.items} />
        ) : (
          <div className="empty-results">
            <h2>The first stories are on their way.</h2>
            <p>
              No films have been published yet. Check back after creators submit their work for
              review.
            </p>
          </div>
        )}
        <PersonalizedShelf />
      </section>
    </>
  );
}
