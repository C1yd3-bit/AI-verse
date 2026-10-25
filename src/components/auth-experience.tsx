import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { publicCollection } from "@/features/discovery/service";
import { isCatalogArtworkPath } from "@/features/discovery/artwork";
import { ArtworkCarousel, type AuthArtwork } from "./auth-artwork-carousel";
import "./auth-experience.css";

export async function AuthExperience({ children }: { children: React.ReactNode }) {
  let films: AuthArtwork[] = [];
  try {
    const collection = await publicCollection({});
    films = collection.items
      .filter(
        (film) =>
          film.status === "published" &&
          film.demo === false &&
          /^\/api\/artwork\//.test(film.artwork) &&
          isCatalogArtworkPath(film.artwork),
      )
      .slice(0, 4)
      .map(({ id, title, artwork }) => ({ id, title, artwork }));
  } catch {
    // Catalog availability never prevents account access or adds fabricated films.
  }
  return (
    <div className="auth-experience">
      <header className="auth-header">
        <Link href="/" className="wordmark" aria-label="AIVerse home">
          <span>AI</span>VERSE
        </Link>
        <Link href="/" className="auth-browse">
          Continue browsing <ArrowRight size={18} aria-hidden="true" />
        </Link>
      </header>
      <div className="auth-split">
        <ArtworkCarousel films={films} />
        <section className="auth-task" aria-label="Your AIVerse account">
          <div className="auth-task-inner">{children}</div>
        </section>
      </div>
    </div>
  );
}
