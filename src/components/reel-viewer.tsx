"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, ChevronDown, ChevronUp, Film, Search } from "lucide-react";
import { durationLabel, label } from "@/features/discovery/catalog";
import {
  appendReelPage,
  createReelQuery,
  reelCatalogParams,
  reelViewerSchema,
  type ReelViewerData,
} from "@/features/reels/schema";
import { accountChangedEvent, accountUnavailableEvent } from "@/lib/appearance";
import { FilmPlayer } from "./film-player";

export function reelPermalink(id: string, backHref: string) {
  return `/reels/${encodeURIComponent(id)}${backHref.slice("/reels".length)}`;
}

export function reelInputOwnsGesture(target: EventTarget | null) {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        "input,textarea,select,a,button,iframe,[contenteditable='true'],[role='dialog'],dialog,.film-playback",
      ),
    )
  );
}

function historyContext(params: URLSearchParams) {
  const canonical = reelCatalogParams(createReelQuery(params), params.get("cursor"));
  // Page size defaults to20; spelling such as07 is still the same browse page.
  canonical.set("limit", String(Number(params.get("limit") ?? 20)));
  return canonical.toString();
}

export function ReelViewer({ initialData }: { initialData: ReelViewerData }) {
  const [viewer, setViewer] = useState(() => reelViewerSchema.parse(initialData));
  const [activeId, setActiveId] = useState(initialData.initialId);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [pageCurrent, setPageCurrent] = useState(true);
  const region = useRef<HTMLDivElement | null>(null);
  const pending = useRef<AbortController | null>(null);
  const consumed = useRef<string[]>([]);
  const lastGestureMove = useRef(-Infinity);
  const router = useRouter();
  const index = viewer.items.findIndex((item) => item.id === activeId);
  const active = viewer.items[index];
  const next = viewer.items[index + 1];
  const previous = viewer.items[index - 1];

  const cancelLoad = useCallback((update = true) => {
    pending.current?.abort();
    pending.current = null;
    if (update) setBusy(false);
  }, []);

  const move = useCallback(
    (direction: -1 | 1) => {
      const target = viewer.items[index + direction];
      if (!target || !pageCurrent) return false;
      cancelLoad();
      setMessage("");
      if (region.current) {
        region.current.scrollTop = 0;
        // The clicked Next/Previous button can become disabled on this commit.
        // Keep keyboard navigation in the viewer rather than losing it to body.
        region.current.focus({ preventScroll: true });
      }
      setActiveId(target.id);
      // Native history integrates with the App Router without fetching adjacent
      // pages or replacing the retained, explicitly loaded public queue.
      window.history.pushState(null, "", reelPermalink(target.id, viewer.backHref));
      return true;
    },
    [viewer, index, pageCurrent, cancelLoad],
  );

  useEffect(() => {
    const element = region.current;
    if (!element) return;
    let accumulated = 0;
    let lastWheel = 0;
    let touch: { x: number; y: number } | null = null;
    const modalOpen = () =>
      Boolean(document.querySelector("dialog[open],[role='dialog'][aria-modal='true']"));
    function wheel(event: WheelEvent) {
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        reelInputOwnsGesture(event.target) ||
        modalOpen() ||
        Math.abs(event.deltaY) <= Math.abs(event.deltaX)
      )
        return;
      const now = performance.now();
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element!.clientHeight : 1);
      const canMove = delta > 0 ? Boolean(next) : Boolean(previous);
      if (!canMove) return;
      event.preventDefault();
      if (now - lastGestureMove.current < 450) return;
      if (now - lastWheel > 250 || Math.sign(delta) !== Math.sign(accumulated)) accumulated = 0;
      lastWheel = now;
      accumulated += delta;
      if (Math.abs(accumulated) >= 90 && move(accumulated > 0 ? 1 : -1)) {
        accumulated = 0;
        lastGestureMove.current = now;
      }
    }
    function touchStart(event: TouchEvent) {
      touch =
        !reelInputOwnsGesture(event.target) && !modalOpen() && event.touches.length === 1
          ? { x: event.touches[0].clientX, y: event.touches[0].clientY }
          : null;
    }
    function touchMove(event: TouchEvent) {
      if (!touch || event.touches.length !== 1) {
        touch = null;
        return;
      }
      const dx = event.touches[0].clientX - touch.x;
      const dy = event.touches[0].clientY - touch.y;
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx) * 1.25 && (dy < 0 ? next : previous))
        event.preventDefault();
    }
    function touchEnd(event: TouchEvent) {
      if (!touch || event.changedTouches.length !== 1) return;
      const dx = event.changedTouches[0].clientX - touch.x;
      const dy = event.changedTouches[0].clientY - touch.y;
      touch = null;
      if (Math.abs(dy) >= 64 && Math.abs(dy) > Math.abs(dx) * 1.25 && move(dy < 0 ? 1 : -1))
        lastGestureMove.current = performance.now();
    }
    function touchCancel() {
      touch = null;
    }
    element.addEventListener("wheel", wheel, { passive: false });
    element.addEventListener("touchstart", touchStart, { passive: true });
    element.addEventListener("touchmove", touchMove, { passive: false });
    element.addEventListener("touchend", touchEnd);
    element.addEventListener("touchcancel", touchCancel);
    return () => {
      element.removeEventListener("wheel", wheel);
      element.removeEventListener("touchstart", touchStart);
      element.removeEventListener("touchmove", touchMove);
      element.removeEventListener("touchend", touchEnd);
      element.removeEventListener("touchcancel", touchCancel);
    };
  }, [move, next, previous]);

  useEffect(() => {
    region.current?.focus({ preventScroll: true });
    function hidden() {
      if (document.visibilityState !== "visible") cancelLoad();
    }
    function identityChanged() {
      cancelLoad();
    }
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener(accountChangedEvent, identityChanged);
    window.addEventListener(accountUnavailableEvent, identityChanged);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener(accountChangedEvent, identityChanged);
      window.removeEventListener(accountUnavailableEvent, identityChanged);
      cancelLoad(false);
    };
  }, [cancelLoad]);

  useEffect(() => {
    const expectedContext = historyContext(
      new URLSearchParams(viewer.backHref.slice("/reels?".length)),
    );
    function pop() {
      cancelLoad();
      const location = new URL(window.location.href);
      const match = /^\/reels\/([^/]+)$/.exec(location.pathname);
      if (!match) {
        setPageCurrent(false);
        return;
      }
      let id: string;
      try {
        id = decodeURIComponent(match[1]);
      } catch {
        setPageCurrent(false);
        router.refresh();
        return;
      }
      let matchingContext = false;
      try {
        matchingContext = historyContext(location.searchParams) === expectedContext;
      } catch {
        /* Invalid filters require the normal server boundary. */
      }
      if (!matchingContext || !viewer.items.some((item) => item.id === id)) {
        setPageCurrent(false);
        router.refresh();
        return;
      }
      setMessage("");
      setPageCurrent(true);
      setActiveId(id);
    }
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [viewer, router, cancelLoad]);

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      reelInputOwnsGesture(event.target) ||
      document.querySelector("dialog[open],[role='dialog'][aria-modal='true']")
    )
      return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (move(event.key === "ArrowDown" ? 1 : -1)) event.preventDefault();
    }
  }

  async function loadMore() {
    const cursor = viewer.nextCursor;
    if (!cursor || pending.current || !pageCurrent) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/catalog?${reelCatalogParams(viewer.query, cursor)}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error(
          response.status === 400
            ? "The catalog changed. Return to Reels to restart this selection."
            : "Could not load more reels. Please try again.",
        );
      const raw: unknown = await response.json();
      if (controller.signal.aborted || pending.current !== controller) return;
      const result = appendReelPage(viewer, raw, cursor, consumed.current);
      consumed.current = result.consumedCursors;
      setViewer(result.viewer);
    } catch (error) {
      if (!controller.signal.aborted)
        setMessage(
          error instanceof Error && /queue limit|catalog changed/i.test(error.message)
            ? error.message
            : "Could not load more reels. Please try again or return to Reels.",
        );
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setBusy(false);
      }
    }
  }

  const currentArtwork = active.artwork || null;
  const previewArtwork = next?.artwork || null;
  return (
    <section className="reel-viewer" aria-label="Reels">
      <header className="reel-toolbar">
        <Link href={viewer.backHref} className="reel-back" onClick={() => cancelLoad()}>
          <ArrowLeft size={22} aria-hidden="true" />
          Back to Reels
        </Link>
        <Link href="/search" className="reel-search" aria-label="Search films">
          <Search size={22} aria-hidden="true" />
        </Link>
      </header>
      <div
        ref={region}
        className="reel-gesture-region"
        role="region"
        tabIndex={0}
        aria-label="Reel viewer"
        aria-describedby="reel-navigation-hint"
        onKeyDown={keyDown}
      >
        <div className="reel-composition">
          <div className="reel-story-column">
            <article
              key={active.id}
              className={`reel-stage${viewer.mode === "live" ? " reel-stage-live" : ""}`}
              aria-label={active.title}
            >
              {currentArtwork ? (
                <Image
                  className="reel-stage-art"
                  src={currentArtwork}
                  unoptimized
                  alt={`Thumbnail for ${active.title}`}
                  fill
                  sizes="(max-width: 700px) calc(100vw - 80px), 480px"
                  priority
                />
              ) : (
                <div className="reel-art-placeholder">
                  <Film size={40} aria-hidden="true" />
                </div>
              )}
              {viewer.mode === "live" && pageCurrent && (
                <FilmPlayer key={active.id} videoId={active.id} title={active.title} />
              )}
              <div className="reel-caption">
                <h1>{active.title}</h1>
                <p className="reel-metadata">
                  {label(active.genres[0] ?? "reel")}
                  <span aria-hidden="true"> · </span>
                  {active.regions[0] && active.regions[0] !== "global"
                    ? `${label(active.regions[0])}-inspired`
                    : "Global inspiration"}
                  <span aria-hidden="true"> · </span>
                  {durationLabel(active.duration)}
                </p>
                <p className="reel-disclosure">AI-created &#183; Reviewed before publication</p>
              </div>
            </article>
            <p id="reel-navigation-hint" className="reel-hint">
              {next || previous ? (
                <>
                  Scroll or use <ArrowUp size={14} aria-hidden="true" />
                  <ArrowDown size={14} aria-hidden="true" /> to explore
                </>
              ) : viewer.nextCursor ? (
                "Load more reels to keep exploring."
              ) : (
                "You're at the end of this selection."
              )}
              <Link
                className="reel-details"
                href={`/watch/${encodeURIComponent(active.id)}`}
                prefetch={false}
              >
                View details
              </Link>
            </p>
            {next && (
              <button
                type="button"
                className="reel-next-peek"
                aria-label={`Next reel: ${next.title}`}
                onClick={() => move(1)}
              >
                {previewArtwork ? (
                  <Image
                    src={previewArtwork}
                    unoptimized
                    alt=""
                    fill
                    sizes="(max-width: 700px) calc(100vw - 80px), 480px"
                    loading="lazy"
                  />
                ) : (
                  <span>{next.title}</span>
                )}
              </button>
            )}
            {!next && viewer.nextCursor && (
              <button
                type="button"
                className="button secondary reel-load-more"
                disabled={busy}
                onClick={() => void loadMore()}
              >
                {busy ? "Loading reels…" : "Load more reels"}
              </button>
            )}
            {!next && !viewer.nextCursor && previous && (
              <p className="reel-end-note">
                End of this selection. <Link href={viewer.backHref}>Explore more reels</Link>
              </p>
            )}
            {message && (
              <p className="reel-load-error" role="alert">
                {message}
              </p>
            )}
          </div>
          <nav className="reel-navigation" aria-label="Reel navigation">
            <button type="button" disabled={!previous || !pageCurrent} onClick={() => move(-1)}>
              <span className="reel-arrow">
                <ChevronUp size={28} aria-hidden="true" />
              </span>
              <span>Previous</span>
            </button>
            <button type="button" disabled={!next || !pageCurrent} onClick={() => move(1)}>
              <span className="reel-arrow">
                <ChevronDown size={28} aria-hidden="true" />
              </span>
              <span>Next</span>
            </button>
          </nav>
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {active.title}. Select play to load this reel.
      </p>
    </section>
  );
}
