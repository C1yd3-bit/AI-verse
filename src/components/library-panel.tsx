"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { discoveryQuerySchema, serializeDiscoveryQuery } from "@/features/discovery/query";
import { accountRequest, AccountRequestError } from "./viewer-actions";
import { notifyAccountChanged } from "@/lib/appearance";

const librarySchema = z.object({
  fusions: z
    .array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        query: discoveryQuerySchema,
        updated_at: z.string(),
      }),
    )
    .max(20),
});
const reportSchema = z.object({
  reports: z
    .array(
      z.object({
        id: z.uuid(),
        video_id: z.uuid(),
        category: z.string(),
        details: z.string(),
        status: z.string(),
        resolution_reason: z.string().nullable(),
        created_at: z.string(),
      }),
    )
    .max(50),
});
const appealSchema = z.object({
  suspensions: z
    .array(
      z.object({ id: z.uuid(), active: z.boolean(), reason: z.string(), created_at: z.string() }),
    )
    .max(20),
  appeals: z
    .array(
      z.object({
        id: z.uuid(),
        suspension_id: z.uuid(),
        statement: z.string(),
        status: z.string(),
        decision_reason: z.string().nullable(),
        created_at: z.string(),
      }),
    )
    .max(20),
});
type LibraryData = z.infer<typeof librarySchema> &
  z.infer<typeof reportSchema> &
  z.infer<typeof appealSchema>;

export function LibraryPanel() {
  const router = useRouter();
  const [data, setData] = useState<LibraryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const load = useCallback(
    (signal?: AbortSignal) =>
      Promise.all([
        accountRequest("/api/me/library", undefined, signal),
        accountRequest("/api/reports", undefined, signal),
        accountRequest("/api/me/appeals", undefined, signal),
      ])
        .then(([library, reports, appeals]) => {
          const result = {
            ...librarySchema.parse(library),
            ...reportSchema.parse(reports),
            ...appealSchema.parse(appeals),
          };
          if (signal?.aborted) return;
          setError("");
          setData(result);
          setSignedOut(false);
        })
        .catch((error: unknown) => {
          if (signal?.aborted) return;
          setSignedOut(error instanceof AccountRequestError && error.status === 401);
          setError(
            error instanceof AccountRequestError
              ? error.message
              : "Your library could not be read. Please try again.",
          );
        })
        .finally(() => {
          if (!signal?.aborted) setLoading(false);
        }),
    [],
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

  async function mutate(path: string, body: unknown, success: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await accountRequest(path, body);
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
  async function signOut() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await accountRequest("/api/auth", { action: "logout" });
      notifyAccountChanged();
      setData(null);
      setSignedOut(true);
      router.refresh();
    } catch (error) {
      setError(
        error instanceof AccountRequestError
          ? error.message
          : "Sign out could not be confirmed. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  function appeal(event: React.FormEvent<HTMLFormElement>, suspensionId: string) {
    event.preventDefault();
    const statement = String(new FormData(event.currentTarget).get("statement") ?? "").trim();
    if (statement.length < 20) {
      setError("Explain your appeal in at least 20 characters.");
      return;
    }
    void mutate(
      "/api/me/appeals",
      { suspensionId, statement },
      "Appeal submitted for administrator review.",
    );
  }

  if (loading && !data)
    return (
      <p className="field-description" role="status">
        Loading your account library…
      </p>
    );
  if (signedOut)
    return (
      <div className="library-content">
        <p className="field-description">
          Sign in to see your saved mixes, reports and creator appeals.
        </p>
        <Link href="/login" className="button primary">
          Sign in
        </Link>
        <div className="auth-links">
          <Link href="/" className="text-link">
            Continue browsing
          </Link>
        </div>
      </div>
    );
  if (!data)
    return (
      <div className="library-content">
        <p className="error-message" role="alert">
          {error}
        </p>
        <button type="button" className="button secondary" onClick={refresh} disabled={loading}>
          Try loading your library again
        </button>
      </div>
    );
  return (
    <div className="library-content" aria-busy={busy || loading}>
      <div className="library-toolbar">
        <Link href="/settings/interests" className="text-link">
          Edit your interests
        </Link>
        <Link href="/studio" className="text-link">
          Creator studio
        </Link>
        <button type="button" className="text-button" disabled={busy || loading} onClick={refresh}>
          {loading ? "Refreshing…" : "Refresh library"}
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() => void signOut()}
        >
          {busy ? "Please wait…" : "Sign out"}
        </button>
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="success-message">
          {message}
        </p>
      )}
      <section className="library-section" aria-labelledby="saved-mixes-title">
        <h2 id="saved-mixes-title">Saved mixes</h2>
        <p className="field-description">
          Your account keeps these filters so you can return to them.
        </p>
        {data.fusions.length ? (
          <ul className="library-list">
            {data.fusions.map((fusion) => (
              <li className="library-row" key={fusion.id}>
                <h3>{fusion.name}</h3>
                <div className="form-actions">
                  <Link
                    className="button secondary"
                    href={`/fusion?${serializeDiscoveryQuery(fusion.query).toString()}`}
                  >
                    Open {fusion.name}
                  </Link>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy || loading}
                    onClick={() =>
                      void mutate(
                        "/api/me/library",
                        { action: "delete_fusion", id: fusion.id },
                        `“${fusion.name}” removed from your library.`,
                      )
                    }
                  >
                    Delete {fusion.name}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="field-description">
            No mixes saved yet.{" "}
            <Link className="text-link" href="/fusion">
              Find a mix in Fusion
            </Link>{" "}
            and choose Save this mix.
          </p>
        )}
      </section>
      <section className="library-section" aria-labelledby="your-reports-title">
        <h2 id="your-reports-title">Your reports</h2>
        <p className="field-description">Your most recent reports and the moderator’s decision.</p>
        {data.reports.length ? (
          <ul className="library-list">
            {data.reports.map((report) => (
              <li className="library-row" key={report.id}>
                <h3>
                  {report.category === "rights"
                    ? "Rights or permission"
                    : report.category === "harmful"
                      ? "Harmful content"
                      : report.category === "misleading"
                        ? "Misleading content"
                        : "Another concern"}
                </h3>
                <p className="library-status">Status: {report.status}</p>
                <p className="library-copy">{report.details}</p>
                {report.resolution_reason && <p>Moderator decision: {report.resolution_reason}</p>}
                <Link href={`/watch/${report.video_id}`} className="text-link">
                  Open reported film
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="field-description">You have not submitted any reports.</p>
        )}
      </section>
      <section className="library-section" aria-labelledby="creator-access-title">
        <h2 id="creator-access-title">Creator access and appeals</h2>
        {!data.suspensions.length && !data.appeals.length && (
          <p className="field-description">
            There are no creator access decisions or appeals on your account.
          </p>
        )}
        <ul className="library-list">
          {data.suspensions.map((suspension) => {
            const pending = data.appeals.some(
              (appeal) => appeal.suspension_id === suspension.id && appeal.status === "pending",
            );
            return (
              <li className="library-row" key={suspension.id}>
                <h3>{suspension.active ? "Creator access suspended" : "Suspension lifted"}</h3>
                <p className="library-copy">{suspension.reason}</p>
                {suspension.active &&
                  (pending ? (
                    <p className="field-description">
                      Your appeal for this decision is awaiting administrator review.
                    </p>
                  ) : (
                    <form
                      className="library-form"
                      onSubmit={(event) => appeal(event, suspension.id)}
                    >
                      <fieldset disabled={busy || loading}>
                        <legend>Appeal this decision</legend>
                        <label>
                          Explain your appeal
                          <textarea
                            name="statement"
                            rows={5}
                            required
                            minLength={20}
                            maxLength={3000}
                          />
                        </label>
                        <p className="field-description">
                          Explain what should be reviewed. You may submit up to three appeals in
                          thirty days.
                        </p>
                        <button className="button secondary">
                          {busy ? "Submitting…" : "Submit appeal"}
                        </button>
                      </fieldset>
                    </form>
                  ))}
              </li>
            );
          })}
        </ul>
        {data.appeals.length > 0 && (
          <>
            <h3 className="library-subheading">Appeal history</h3>
            <ul className="library-list">
              {data.appeals.map((appeal) => (
                <li className="library-row" key={appeal.id}>
                  <p className="library-status">Status: {appeal.status}</p>
                  <p className="library-copy">{appeal.statement}</p>
                  {appeal.decision_reason && (
                    <p>Administrator decision: {appeal.decision_reason}</p>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
