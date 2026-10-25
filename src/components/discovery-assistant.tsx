"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ArrowRight, ArrowUp, RotateCcw, Sparkles, Square, X } from "lucide-react";
import { accountChangedEvent, accountUnavailableEvent } from "@/lib/appearance";
import {
  assistantResponseSchema,
  type AssistantInput,
  type AssistantResponse,
} from "@/features/assistant/schema";
import { durationLabel } from "@/features/discovery/catalog";
import { SavedFusion } from "./saved-fusion";
import { useAppearance } from "./appearance-provider";
import "@/app/assistant.css";

type Turn = { id: number; message: string; response: AssistantResponse };
const prompts = [
  "Cat cooking spaghetti",
  "Korean romantic reels under 2 minutes",
  "Filipino horror in Tagalog",
];
const refinements = ["Shorter", "More comedy", "In Tagalog"];

export function DiscoveryAssistant(_props: { liveCatalog?: boolean } = {}) {
  void _props;
  const appearance = useAppearance();
  const id = useId();
  const path = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const currentTurn = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const turnSequence = useRef(0);
  const previousPath = useRef(path);
  const previousAccount = useRef<string | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState<AssistantInput | null>(null);
  const [session, setSession] = useState(0);
  const latestTurn = turns.at(-1);
  const latest = latestTurn?.response;

  const cancelRequest = useCallback(() => {
    generation.current += 1;
    request.current?.abort();
    request.current = null;
    setPending(null);
  }, []);
  const close = useCallback(() => {
    cancelRequest();
    dialog.current?.close();
    setOpen(false);
  }, [cancelRequest]);
  const reset = useCallback(() => {
    cancelRequest();
    setTurns([]);
    setDraft("");
    setError("");
    setNotice("");
    setRetry(null);
    setSession((value) => value + 1);
  }, [cancelRequest]);

  useEffect(() => {
    const changed = () => {
      close();
      reset();
    };
    const unavailable = () => {
      if (previousAccount.current == null) return;
      close();
      reset();
      previousAccount.current = null;
    };
    window.addEventListener(accountChangedEvent, changed);
    window.addEventListener(accountUnavailableEvent, unavailable);
    return () => {
      window.removeEventListener(accountChangedEvent, changed);
      window.removeEventListener(accountUnavailableEvent, unavailable);
      generation.current += 1;
      request.current?.abort();
    };
  }, [close, reset]);
  useEffect(() => {
    if (previousPath.current !== path) {
      previousPath.current = path;
      close();
    }
  }, [path, close]);
  useEffect(() => {
    if (!appearance.ready) return;
    if (previousAccount.current !== undefined && previousAccount.current !== appearance.accountId) {
      close();
      reset();
    }
    previousAccount.current = appearance.accountId;
  }, [appearance.ready, appearance.accountId, close, reset]);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);
  useEffect(() => {
    const area = scrollArea.current;
    if (area && currentTurn.current) {
      area.scrollTop +=
        currentTurn.current.getBoundingClientRect().top - area.getBoundingClientRect().top - 24;
    }
  }, [turns]);
  useEffect(() => {
    const area = scrollArea.current;
    if (area && (pending || error || notice)) area.scrollTop = area.scrollHeight;
  }, [pending, error, notice]);

  async function send(message: string, referenceVideoId?: string, retryInput?: AssistantInput) {
    const text = message.trim();
    if (!text || text.length > 500 || request.current) return;
    const input: AssistantInput = retryInput ?? {
      message: text,
      ...(latest ? { context: latest.query } : {}),
      ...(referenceVideoId ? { referenceVideoId } : {}),
    };
    const controller = new AbortController();
    request.current = controller;
    const currentGeneration = ++generation.current;
    setDraft(text);
    setPending(text);
    setError("");
    setNotice("");
    setRetry(input);
    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
      });
      if (!response.ok)
        throw new Error(
          response.status === 503
            ? "The catalog is unavailable. Try again in a moment."
            : "This search could not be completed. Check your request and try again.",
        );
      const result = assistantResponseSchema.parse(await response.json());
      if (currentGeneration !== generation.current || controller.signal.aborted) return;
      const turn = { id: ++turnSequence.current, message: text, response: result };
      setTurns((history) => [...history, turn].slice(-8));
      setDraft("");
      setRetry(null);
    } catch (failure) {
      if (currentGeneration !== generation.current || controller.signal.aborted) return;
      setError(
        failure instanceof Error && !(failure.name === "ZodError")
          ? failure.message === "The catalog is unavailable. Try again in a moment." ||
            failure.message ===
              "This search could not be completed. Check your request and try again."
            ? failure.message
            : "The catalog could not be reached. Your request is kept below; try again."
          : "The catalog response could not be read. Try again.",
      );
    } finally {
      if (currentGeneration === generation.current) {
        request.current = null;
        setPending(null);
      }
    }
  }

  function results(items: AssistantResponse["exact"]["items"]) {
    return items.map(({ video, reason }) => (
      <article className="assistant-result" key={video.id}>
        <Link
          className="assistant-artwork"
          href={`/watch/${encodeURIComponent(video.id)}`}
          onClick={close}
          aria-label={`View details for ${video.title}`}
        >
          {video.artwork ? (
            <Image
              src={video.artwork}
              unoptimized
              alt={`${video.title} - film artwork`}
              width={768}
              height={432}
              sizes="(max-width: 500px) 90vw, 392px"
            />
          ) : (
            <span className="assistant-artwork-missing">Artwork unavailable</span>
          )}
        </Link>
        <Link
          className="assistant-film-title"
          href={`/watch/${encodeURIComponent(video.id)}`}
          onClick={close}
        >
          {video.title}
        </Link>
        <p className="assistant-meta">
          {video.format === "reel" ? "Reel" : "Short film"} · {durationLabel(video.duration)}
          &#183; AI-created
        </p>
        <p className="assistant-reason">{reason}</p>
        <div className="assistant-result-actions">
          <Link href={`/watch/${encodeURIComponent(video.id)}`} onClick={close}>
            View details <ArrowRight size={15} aria-hidden="true" />
          </Link>
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => void send("More like this", video.id)}
          >
            More like this
          </button>
        </div>
      </article>
    ));
  }

  return (
    <>
      <button
        ref={launcher}
        className="assistant-launcher"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => {
          dialog.current?.showModal();
          setOpen(true);
        }}
      >
        <Sparkles size={19} aria-hidden="true" />
        <span>Ask AIVerse</span>
      </button>
      <dialog
        ref={dialog}
        id={id}
        className="assistant-drawer"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        onCancel={close}
        onClose={() => {
          cancelRequest();
          setOpen(false);
          launcher.current?.focus();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            const rect = event.currentTarget.getBoundingClientRect();
            if (event.clientX < rect.left || event.clientX > rect.right) close();
          }
        }}
      >
        <header className="assistant-header">
          <div className="assistant-heading">
            <h2 id={`${id}-title`}>Ask AIVerse</h2>
            <button
              type="button"
              className="assistant-icon-button"
              aria-label="Close Ask AIVerse"
              onClick={close}
            >
              <X size={22} aria-hidden="true" />
            </button>
          </div>
          <div className="assistant-subheading">
            <p id={`${id}-description`}>Catalog helper &#183; Published films</p>
            <button
              type="button"
              onClick={() => {
                reset();
                composer.current?.focus();
              }}
            >
              <RotateCcw size={14} aria-hidden="true" />
              New search
            </button>
          </div>
        </header>
        <div ref={scrollArea} className="assistant-scroll">
          {!turns.length && !pending && !error && (
            <div className="assistant-welcome">
              <Sparkles size={28} aria-hidden="true" />
              <h3>Find your next escape.</h3>
              <p>Describe what you feel like watching. I’ll find matches in the catalog.</p>
              <div className="assistant-prompts">
                {prompts.map((prompt) => (
                  <button type="button" key={prompt} onClick={() => void send(prompt)}>
                    {prompt}
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>
          )}
          {turns.map((turn, index) => (
            <div
              ref={index === turns.length - 1 ? currentTurn : undefined}
              className="assistant-turn"
              key={`${session}-${turn.id}`}
            >
              <p className="assistant-user">
                <span className="assistant-sr-only">You: </span>
                {turn.message}
              </p>
              {index !== turns.length - 1 && (
                <p className="assistant-history-reply">
                  <span className="assistant-sr-only">AIVerse: </span>
                  {turn.response.reply}
                </p>
              )}
            </div>
          ))}
          {latest && (
            <section className="assistant-current" aria-label="Current catalog results">
              <p className="assistant-reply" role="status">
                {latest.reply}
              </p>
              {latest.filters.length > 0 && (
                <ul className="assistant-filters" aria-label="Current filters">
                  {latest.filters.map((filter) => (
                    <li key={filter.label}>
                      <span>{filter.label}: </span>
                      {filter.value}
                    </li>
                  ))}
                </ul>
              )}
              {latest.exact.items.length > 0 && (
                <div className="assistant-results">
                  <h3>
                    {latest.exact.total} exact
                    {latest.exact.total === 1 ? "match" : "matches"}
                  </h3>
                  {results(latest.exact.items)}
                </div>
              )}
              {latest.broader.items.length > 0 && (
                <div className="assistant-results assistant-broader">
                  <h3>Broader suggestions</h3>
                  <p className="assistant-meta">{latest.broader.label}</p>
                  {results(latest.broader.items)}
                </div>
              )}
              {!latest.clarification && (
                <>
                  <div className="assistant-mix-actions">
                    <Link className="button primary" href={latest.fusionUrl} onClick={close}>
                      <Sparkles size={17} aria-hidden="true" />
                      Open in Fusion
                    </Link>
                    <Link className="text-link" href={latest.searchUrl} onClick={close}>
                      See all results <ArrowRight size={15} aria-hidden="true" />
                    </Link>
                  </div>
                  {appearance.ready && appearance.accountId ? (
                    <SavedFusion
                      key={`${appearance.accountId}-${session}-${latestTurn.id}`}
                      query={latest.query}
                      expectedAccountId={appearance.accountId}
                    />
                  ) : (
                    <p className="assistant-sign-in">
                      <Link className="text-link" href="/login" onClick={close}>
                        Log in to save this mix
                      </Link>
                    </p>
                  )}
                </>
              )}
              <div className="assistant-refine">
                <p>Refine your search</p>
                <div>
                  {refinements.map((refinement) => (
                    <button
                      key={refinement}
                      type="button"
                      disabled={pending !== null}
                      onClick={() => void send(refinement)}
                    >
                      {refinement}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )}
          {pending && (
            <div className="assistant-pending">
              <p className="assistant-user">
                <span className="assistant-sr-only">You: </span>
                {pending}
              </p>
              <p role="status">Searching the catalog…</p>
            </div>
          )}
          {error && (
            <div className="assistant-error">
              <p role="alert">{error}</p>
              <button
                type="button"
                className="text-link"
                disabled={pending !== null || !retry}
                onClick={() => {
                  if (retry) void send(retry.message, retry.referenceVideoId, retry);
                }}
              >
                Retry search
              </button>
            </div>
          )}
          {notice && (
            <p className="assistant-status" role="status">
              {notice}
            </p>
          )}
        </div>
        <form
          className="assistant-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send(draft);
          }}
        >
          <label className="assistant-sr-only" htmlFor={`${id}-message`}>
            What do you feel like watching?
          </label>
          <div className="assistant-composer-field">
            <textarea
              ref={composer}
              id={`${id}-message`}
              value={draft}
              maxLength={500}
              rows={2}
              placeholder="What do you feel like watching?"
              disabled={pending !== null}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            {pending !== null ? (
              <button
                type="button"
                className="assistant-send"
                aria-label="Stop searching"
                onClick={() => {
                  cancelRequest();
                  setNotice("Search stopped. Your previous filters are kept.");
                }}
              >
                <Square size={16} aria-hidden="true" />
              </button>
            ) : (
              <button
                type="submit"
                className="assistant-send"
                aria-label="Send message"
                disabled={!draft.trim()}
              >
                <ArrowUp size={20} aria-hidden="true" />
              </button>
            )}
          </div>
          <p className="assistant-footnote">
            Rule-based discovery &#183; Published catalog only
            <span>{draft.length}/500</span>
          </p>
        </form>
      </dialog>
    </>
  );
}
