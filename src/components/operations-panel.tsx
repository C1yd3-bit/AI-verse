"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { accountRequest, AccountRequestError } from "./viewer-actions";

const operationsSchema = z.object({
  roles: z.array(z.string()),
  reports: z
    .array(
      z.object({
        id: z.uuid(),
        video_id: z.uuid(),
        category: z.string(),
        details: z.string(),
        status: z.string(),
        created_at: z.string(),
      }),
    )
    .max(50),
  appeals: z
    .array(
      z.object({
        id: z.uuid(),
        creator_id: z.uuid(),
        suspension_id: z.uuid(),
        statement: z.string(),
        status: z.string(),
        created_at: z.string(),
      }),
    )
    .max(50),
  summary: z.record(z.string(), z.number().finite()).nullable(),
});
type Operations = z.infer<typeof operationsSchema>;
const uuid = z.uuid();
const summaryLabels: [string, string][] = [
  ["published_videos", "Published films"],
  ["pending_reports", "Pending reports"],
  ["active_suspensions", "Active creator suspensions"],
  ["pending_appeals", "Pending appeals"],
  ["pending_deletions", "Deletion jobs awaiting completion"],
  ["processing_assets", "Assets processing"],
  ["failed_assets", "Assets with processing failures"],
  ["stored_seconds", "Estimated stored video seconds"],
  ["claimed_watch_seconds_utc_day", "Claimed watch seconds today (UTC)"],
  ["credited_completions_utc_day", "Credited completions today (UTC)"],
];

export function OperationsPanel() {
  const [data, setData] = useState<Operations | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [access, setAccess] = useState<"signin" | "denied" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [quotaMode, setQuotaMode] = useState("set");
  const load = useCallback(
    (signal?: AbortSignal) =>
      accountRequest("/api/operations", undefined, signal)
        .then((value) => {
          const result = operationsSchema.parse(value);
          if (signal?.aborted) return;
          setError("");
          setData(result);
          setAccess(null);
        })
        .catch((error: unknown) => {
          if (signal?.aborted) return;
          setAccess(
            error instanceof AccountRequestError && error.status === 401
              ? "signin"
              : error instanceof AccountRequestError && error.status === 403
                ? "denied"
                : null,
          );
          setError(
            error instanceof AccountRequestError
              ? error.message
              : "The operations queue could not be read. Try again.",
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
  async function decide(body: unknown, success: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await accountRequest("/api/operations", body);
      await load();
      setMessage(success);
    } catch (error) {
      setAccess(
        error instanceof AccountRequestError && error.status === 401
          ? "signin"
          : error instanceof AccountRequestError && error.status === 403
            ? "denied"
            : null,
      );
      setError(
        error instanceof AccountRequestError
          ? error.message
          : "The decision could not be saved. Refresh the queue and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  function formValues(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const reason = String(fields.get("reason") ?? "").trim();
    if (reason.length < 5) {
      setError("Give a decision reason of at least five characters.");
      return null;
    }
    return { fields, reason };
  }
  function reportDecision(event: React.FormEvent<HTMLFormElement>, id: string) {
    const values = formValues(event);
    if (values)
      void decide(
        {
          action: "resolve_report",
          id,
          resolution: values.fields.get("resolution"),
          reason: values.reason,
        },
        "Report resolved and the decision recorded.",
      );
  }
  function appealDecision(event: React.FormEvent<HTMLFormElement>, id: string) {
    const values = formValues(event);
    if (values)
      void decide(
        {
          action: "resolve_appeal",
          id,
          approved: values.fields.get("decision") === "approve",
          reason: values.reason,
        },
        "Appeal decision recorded.",
      );
  }
  function suspensionDecision(event: React.FormEvent<HTMLFormElement>) {
    const values = formValues(event);
    if (!values) return;
    const creatorId = String(values.fields.get("creatorId") ?? "").trim();
    if (!uuid.safeParse(creatorId).success) {
      setError("Enter the full creator account ID shown in the review record.");
      return;
    }
    void decide(
      {
        action: "suspend",
        creatorId,
        suspended: values.fields.get("decision") === "suspend",
        reason: values.reason,
      },
      "Creator access decision recorded.",
    );
  }
  function quotaDecision(event: React.FormEvent<HTMLFormElement>) {
    const values = formValues(event);
    if (!values) return;
    const creatorId = String(values.fields.get("creatorId") ?? "").trim();
    if (!uuid.safeParse(creatorId).success) {
      setError("Enter the full creator account ID.");
      return;
    }
    if (quotaMode === "clear") {
      void decide(
        {
          action: "quota",
          creatorId,
          dailyUploads: null,
          monthlySeconds: null,
          expiresAt: null,
          reason: values.reason,
        },
        "Quota override cleared. The account now uses the default limits.",
      );
      return;
    }
    const expiry = new Date(String(values.fields.get("expiry") ?? ""));
    const dailyUploads = Number(values.fields.get("dailyUploads"));
    const monthlyMinutes = Number(values.fields.get("monthlyMinutes"));
    if (
      !Number.isFinite(expiry.getTime()) ||
      expiry.getTime() <= Date.now() ||
      expiry.getTime() > Date.now() + 90 * 86400000
    ) {
      setError("Choose a future expiry within ninety days, using your local time.");
      return;
    }
    if (
      !Number.isInteger(dailyUploads) ||
      dailyUploads < 1 ||
      dailyUploads > 100 ||
      !Number.isInteger(monthlyMinutes) ||
      monthlyMinutes < 3 ||
      monthlyMinutes > 1440
    ) {
      setError("Use 1–100 uploads per day and 3–1440 video minutes per month.");
      return;
    }
    void decide(
      {
        action: "quota",
        creatorId,
        dailyUploads,
        monthlySeconds: monthlyMinutes * 60,
        expiresAt: expiry.toISOString(),
        reason: values.reason,
      },
      "Expiring quota override recorded.",
    );
  }

  if (loading && !data)
    return (
      <p className="field-description" role="status">
        Loading the operations queue…
      </p>
    );
  if (access === "signin")
    return (
      <div className="library-content">
        <p className="field-description">
          Sign in with a moderator or administrator account to open this workspace.
        </p>
        <Link href="/login" className="button primary">
          Sign in
        </Link>
      </div>
    );
  if (access === "denied")
    return (
      <div className="library-content">
        <p className="field-description">
          This workspace is available to moderators and administrators. Creator access and appeals
          are available in your library.
        </p>
        <Link href="/library" className="text-link">
          Open your library
        </Link>
        <div className="library-toolbar">
          <button type="button" className="button secondary" disabled={loading} onClick={refresh}>
            Check access again
          </button>
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
          Try loading the queue again
        </button>
      </div>
    );
  const admin = data.roles.includes("admin");
  return (
    <div className="library-content" aria-busy={busy || loading}>
      <div className="library-toolbar">
        <Link href="/moderation" className="text-link">
          Review pending films
        </Link>
        <Link href="/library" className="text-link">
          Your library
        </Link>
        <button
          type="button"
          className="button secondary"
          disabled={busy || loading}
          onClick={refresh}
        >
          {loading ? "Refreshing…" : "Refresh queue"}
        </button>
      </div>
      <p className="field-description">
        {admin
          ? "Administrator access includes creator decisions and operational summaries."
          : "Moderator access includes reports and film review. Creator access decisions require an administrator."}
      </p>
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
      <section className="library-section" aria-labelledby="pending-reports-title">
        <h2 id="pending-reports-title">Pending reports</h2>
        <p className="field-description">
          Showing up to fifty pending reports, oldest first. Hiding or removing a film immediately
          prevents new playback grants.
        </p>
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
                <p className="library-copy">{report.details}</p>
                <Link className="text-link" href={`/watch/${report.video_id}`}>
                  Open reported film
                </Link>
                <form
                  className="library-form"
                  onSubmit={(event) => reportDecision(event, report.id)}
                >
                  <fieldset disabled={busy || loading}>
                    <legend>Resolve this report</legend>
                    <label>
                      Decision
                      <select name="resolution" required defaultValue="">
                        <option value="" disabled>
                          Choose a decision
                        </option>
                        <option value="dismiss">Dismiss report</option>
                        <option value="hide">Hide film</option>
                        <option value="remove">Remove film</option>
                      </select>
                    </label>
                    <label>
                      Decision reason
                      <textarea name="reason" required minLength={5} maxLength={1000} rows={3} />
                    </label>
                    <button className="button secondary">
                      {busy ? "Saving…" : "Record report decision"}
                    </button>
                  </fieldset>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="field-description">There are no pending reports.</p>
        )}
      </section>
      {admin && (
        <>
          <section className="library-section" aria-labelledby="pending-appeals-title">
            <h2 id="pending-appeals-title">Creator appeals</h2>
            <p className="field-description">
              Showing up to fifty pending appeals. Approval lifts only the suspension incident named
              in that appeal.
            </p>
            {data.appeals.length ? (
              <ul className="library-list">
                {data.appeals.map((appeal) => (
                  <li className="library-row" key={appeal.id}>
                    <h3>Creator access appeal</h3>
                    <p className="library-status">Creator account: {appeal.creator_id}</p>
                    <p className="library-copy">{appeal.statement}</p>
                    <form
                      className="library-form"
                      onSubmit={(event) => appealDecision(event, appeal.id)}
                    >
                      <fieldset disabled={busy || loading}>
                        <legend>Decide this appeal</legend>
                        <label>
                          Decision
                          <select name="decision" required defaultValue="">
                            <option value="" disabled>
                              Choose a decision
                            </option>
                            <option value="approve">Approve and lift this suspension</option>
                            <option value="reject">Reject appeal</option>
                          </select>
                        </label>
                        <label>
                          Decision reason
                          <textarea
                            name="reason"
                            required
                            minLength={5}
                            maxLength={1000}
                            rows={3}
                          />
                        </label>
                        <button className="button secondary">
                          {busy ? "Saving…" : "Record appeal decision"}
                        </button>
                      </fieldset>
                    </form>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="field-description">There are no pending creator appeals.</p>
            )}
          </section>
          <section className="library-section" aria-labelledby="creator-access-decision-title">
            <h2 id="creator-access-decision-title">Creator access</h2>
            <p className="field-description">
              Suspension hides approved films and stops new drafts and uploads. Lifting a suspension
              restores previously approved visibility. Every decision records your reason.
            </p>
            <form className="library-form" onSubmit={suspensionDecision}>
              <fieldset disabled={busy || loading}>
                <legend className="visually-hidden">Change creator access</legend>
                <label>
                  Creator account ID
                  <input name="creatorId" required autoComplete="off" />
                </label>
                <label>
                  Decision
                  <select name="decision" required defaultValue="">
                    <option value="" disabled>
                      Choose a decision
                    </option>
                    <option value="suspend">Suspend creator access</option>
                    <option value="reinstate">Lift active suspension</option>
                  </select>
                </label>
                <label>
                  Decision reason
                  <textarea name="reason" rows={3} required minLength={5} maxLength={1000} />
                </label>
                <button className="button secondary">
                  {busy ? "Saving…" : "Record creator access decision"}
                </button>
              </fieldset>
            </form>
          </section>
          <section className="library-section" aria-labelledby="quota-override-title">
            <h2 id="quota-override-title">Upload allowance</h2>
            <p className="field-description">
              Use an expiring override for an uploading account. Per-film duration remains limited
              to three minutes for Reels and twenty minutes for Movies. These controls require an
              approved operational budget before live uploads.
            </p>
            <form className="library-form" onSubmit={quotaDecision}>
              <fieldset disabled={busy || loading}>
                <legend className="visually-hidden">Set or clear a quota override</legend>
                <label>
                  Creator account ID
                  <input name="creatorId" required autoComplete="off" />
                </label>
                <label>
                  Change
                  <select value={quotaMode} onChange={(event) => setQuotaMode(event.target.value)}>
                    <option value="set">Set an expiring override</option>
                    <option value="clear">Clear override and use defaults</option>
                  </select>
                </label>
                {quotaMode === "set" && (
                  <>
                    <label>
                      Uploads per UTC day
                      <input
                        name="dailyUploads"
                        type="number"
                        required
                        min={1}
                        max={100}
                        step={1}
                      />
                    </label>
                    <label>
                      Video minutes per UTC month
                      <input
                        name="monthlyMinutes"
                        type="number"
                        required
                        min={3}
                        max={1440}
                        step={1}
                      />
                    </label>
                    <label>
                      Expiry in your local time
                      <input name="expiry" type="datetime-local" required />
                    </label>
                    <p className="field-description">
                      Choose a future date within ninety days. Expired overrides return to the
                      default allowance.
                    </p>
                  </>
                )}
                <label>
                  Decision reason
                  <textarea name="reason" required minLength={5} maxLength={1000} rows={3} />
                </label>
                <button className="button secondary">
                  {busy
                    ? "Saving…"
                    : quotaMode === "clear"
                      ? "Clear quota override"
                      : "Record expiring override"}
                </button>
              </fieldset>
            </form>
          </section>
          {data.summary && (
            <section className="library-section" aria-labelledby="operational-summary-title">
              <h2 id="operational-summary-title">Operational summary</h2>
              <dl className="library-summary">
                {summaryLabels
                  .filter(([key]) => data.summary?.[key] !== undefined)
                  .map(([key, label]) => (
                    <div key={key}>
                      <dt>{label}</dt>
                      <dd>{data.summary![key].toLocaleString()}</dd>
                    </div>
                  ))}
              </dl>
              <p className="field-description">
                Storage is an estimate from reconciled media records. Watch seconds are bounded
                client reports, not provider delivery measurements. Billing and delivered-minute
                costs must be checked with the configured provider.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
