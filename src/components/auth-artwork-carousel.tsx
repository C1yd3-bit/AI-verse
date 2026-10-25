"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { Pause, Play } from "lucide-react";

export type AuthArtwork = { id: string; title: string; artwork: string };

export function ArtworkCarousel({ films: publishedFilms }: { films: AuthArtwork[] }) {
  const [failed, setFailed] = useState<string[]>([]);
  const films = publishedFilms.filter((film) => !failed.includes(film.id));
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReducedMotion(motion.matches);
    const updateVisibility = () => setHidden(document.hidden);
    updateMotion();
    updateVisibility();
    motion.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", updateVisibility);
    return () => {
      motion.removeEventListener("change", updateMotion);
      document.removeEventListener("visibilitychange", updateVisibility);
    };
  }, []);
  useEffect(() => {
    if (films.length < 2 || !playing || reducedMotion || hovered || focused || hidden) return;
    const interval = window.setInterval(
      () => setActive((value) => (value + 1) % films.length),
      8000,
    );
    return () => window.clearInterval(interval);
  }, [playing, reducedMotion, hovered, focused, hidden, films.length]);
  if (!films.length)
    return (
      <aside className="auth-artwork auth-artwork-empty" aria-label="Welcome to AIVerse">
        <div className="auth-empty-caption">
          <p className="auth-film-title">A world of imagination.</p>
          <p>Discover AI-created stories. Make room for your next world.</p>
        </div>
      </aside>
    );
  const selected = active % films.length;
  return (
    <aside
      className="auth-artwork"
      aria-label="Published AIVerse films"
      aria-roledescription="carousel"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      {films.map((film, index) => (
        <div
          className="auth-art-slide"
          key={film.id}
          data-active={selected === index}
          aria-hidden="true"
        >
          <Image
            src={film.artwork}
            unoptimized
            onError={() => setFailed((ids) => (ids.includes(film.id) ? ids : [...ids, film.id]))}
            alt=""
            fill
            sizes="(max-width: 760px) 100vw, 56vw"
            priority={index === 0}
          />
        </div>
      ))}
      <div className="auth-art-caption">
        <p className="auth-film-title">{films[selected].title}</p>
        <p className="auth-art-disclosure">AI-created &#183; Reviewed before publication</p>
        {films.length > 1 && (
          <div className="auth-art-controls">
            <div className="auth-thumbnails" aria-label="Choose artwork">
              {films.map((film, index) => (
                <button
                  type="button"
                  key={film.id}
                  aria-label={`Show ${film.title}`}
                  aria-pressed={selected === index}
                  onClick={() => setActive(index)}
                >
                  <Image src={film.artwork} unoptimized alt="" fill sizes="72px" />
                  <span className="auth-thumb-indicator" />
                </button>
              ))}
            </div>
            <button
              type="button"
              className="auth-carousel-toggle"
              disabled={reducedMotion}
              aria-label={
                reducedMotion
                  ? "Automatic artwork changes are off for reduced motion"
                  : playing
                    ? "Pause artwork carousel"
                    : "Play artwork carousel"
              }
              onClick={() => setPlaying((value) => !value)}
            >
              {playing && !reducedMotion ? (
                <Pause size={17} aria-hidden="true" />
              ) : (
                <Play size={17} aria-hidden="true" />
              )}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
