"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import "@/app/library/library.css";

export class AccountRequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AccountRequestError";
  }
}

export async function accountRequest(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  try {
    const timeout = AbortSignal.timeout(15000);
    const response = await fetch(path, {
      cache: "no-store",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      ...(body === undefined
        ? {}
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
    if (!response.ok) {
      const message =
        response.status === 401
          ? "Sign in to use your account."
          : response.status === 403
            ? "Your account does not have access to this action."
            : response.status === 503
              ? "Account services are unavailable. Try again when they are configured."
              : "The action could not be completed. Refresh the current status and try again.";
      throw new AccountRequestError(response.status, message);
    }
    return (await response.json()) as unknown;
  } catch (error) {
    if (error instanceof AccountRequestError) throw error;
    throw new AccountRequestError(
      0,
      "The request could not be confirmed. Check your connection and try again.",
    );
  }
}

const activitySchema = z.object({
  signals: z
    .array(z.object({ video_id: z.uuid(), signal: z.enum(["like", "not_interested"]) }))
    .max(1000),
  follows: z.array(z.object({ creator_id: z.uuid() })).max(1000),
});
type Activity = z.infer<typeof activitySchema>;

/** Render only for a live catalog record, never a fictional sample. */
export function ViewerActions({ videoId, creatorId }: { videoId: string; creatorId: string }) {
  const [activity, setActivity] = useState<Activity | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [signedOut, setSignedOut] = useState(false);
  const load = useCallback(
    (signal?: AbortSignal) =>
      accountRequest(
        `/api/me/library?videoId=${encodeURIComponent(videoId)}&creatorId=${encodeURIComponent(creatorId)}`,
        undefined,
        signal,
      )
        .then((value) => {
          const result = activitySchema.parse(value);
          if (signal?.aborted) return;
          setError("");
          setActivity(result);
          setSignedOut(false);
        })
        .catch((error: unknown) => {
          if (signal?.aborted) return;
          setSignedOut(error instanceof AccountRequestError && error.status === 401);
          setError(
            error instanceof AccountRequestError
              ? error.message
              : "Your activity could not be read. Try again.",
          );
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false);
        }),
    [videoId, creatorId],
  );
  function refresh() {
    setLoading(true);
    setError("");
    void load();
  }
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function change(body: unknown, success: string) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await accountRequest("/api/me/library", body);
      await load();
      setMessage(success);
    } catch (error) {
      setSignedOut(error instanceof AccountRequestError && error.status === 401);
      setError(
        error instanceof AccountRequestError
          ? error.message
          : "Your change could not be saved. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function report(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const details = String(data.get("details") ?? "").trim();
    if (details.length < 5) {
      setError("Describe the concern in at least five characters.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await accountRequest("/api/reports", {
        videoId,
        category: data.get("category"),
        details,
      });
      form.reset();
      setMessage("Report submitted. You can follow its status in your library.");
    } catch (error) {
      setSignedOut(error instanceof AccountRequestError && error.status === 401);
      setError(
        error instanceof AccountRequestError
          ? error.message
          : "The report could not be submitted. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (loading && !activity)
    return (
      <p className="field-description" role="status">
        Loading your account actions…
      </p>
    );
  if (signedOut)
    return (
      <p className="field-description">
        <Link className="text-link" href="/login">
          Sign in
        </Link>{" "}
        to like films, follow creators or report a concern.
      </p>
    );
  if (!activity)
    return (
      <div className="account-actions">
        <p className="error-message" role="alert">
          {error}
        </p>
        <button type="button" className="button secondary" onClick={refresh} disabled={loading}>
          {loading ? "Loading…" : "Try account actions again"}
        </button>
      </div>
    );
  const liked = activity.signals.some(
    (signal) => signal.video_id === videoId && signal.signal === "like",
  );
  const uninterested = activity.signals.some(
    (signal) => signal.video_id === videoId && signal.signal === "not_interested",
  );
  const followed = activity.follows.some((follow) => follow.creator_id === creatorId);
  return (
    <section className="account-actions" aria-label="Your film actions" aria-busy={busy}>
      <div className="form-actions">
        <button
          type="button"
          className="button secondary"
          aria-pressed={liked}
          disabled={busy || loading}
          onClick={() =>
            void change(
              { action: "signal", videoId, signal: "like", enabled: !liked },
              liked ? "Like removed." : "Film liked.",
            )
          }
        >
          {liked ? "Unlike film" : "Like film"}
        </button>
        <button
          type="button"
          className="button secondary"
          aria-pressed={followed}
          disabled={busy || loading}
          onClick={() =>
            void change(
              { action: "follow", creatorId, enabled: !followed },
              followed ? "Creator unfollowed." : "Creator followed.",
            )
          }
        >
          {followed ? "Unfollow creator" : "Follow creator"}
        </button>
        <button
          type="button"
          className="text-button"
          aria-pressed={uninterested}
          disabled={busy || loading}
          onClick={() =>
            void change(
              { action: "signal", videoId, signal: "not_interested", enabled: !uninterested },
              uninterested ? "Not Interested removed." : "Not Interested saved.",
            )
          }
        >
          {uninterested ? "Undo Not Interested" : "Not Interested"}
        </button>
      </div>
      <details className="account-disclosure">
        <summary>Report this film</summary>
        <form className="library-form" onSubmit={report}>
          <fieldset disabled={busy}>
            <legend className="visually-hidden">Report this film</legend>
            <label>
              Concern
              <select name="category" defaultValue="rights">
                <option value="rights">Rights or permission</option>
                <option value="harmful">Harmful content</option>
                <option value="misleading">Misleading content</option>
                <option value="other">Another concern</option>
              </select>
            </label>
            <label>
              Describe the concern
              <textarea name="details" required minLength={5} maxLength={2000} rows={4} />
            </label>
            <p className="field-description">
              Include enough detail for a moderator to investigate. You can submit up to five
              reports per UTC day.
            </p>
            <button className="button secondary">{busy ? "Please wait…" : "Submit report"}</button>
          </fieldset>
        </form>
      </details>
      {error && (
        <p className="error-message" role="alert">
          {error}{" "}
          <Link className="text-link" href="/library">
            Check your library
          </Link>{" "}
          before resubmitting a report.
        </p>
      )}
      {message && (
        <p className="success-message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
