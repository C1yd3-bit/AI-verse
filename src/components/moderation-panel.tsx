"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { decisionInput, versionInput } from "@/features/media/schema";
import { FilmPlayer } from "./film-player";
import { VersionArtworkPreview } from "./version-artwork";
import { useAppearance } from "./appearance-provider";
import { accountChangedEvent, accountUnavailableEvent } from "@/lib/appearance";

const queueSchema = z.object({
  roles: z.array(z.string()),
  versions: z.array(
    z.object({
      id: z.uuid(),
      video_id: z.uuid(),
      revision: z.number(),
      state: z.string(),
      metadata: versionInput.shape.metadata,
      duration_seconds: z.number().nullable(),
    }),
  ),
  applications: z.array(
    z.object({
      id: z.uuid(),
      user_id: z.uuid(),
      status: z.string(),
      application: z.object({
        display_name: z.string(),
        handle: z.string(),
        bio: z.string(),
        portfolio_url: z.string(),
      }),
    }),
  ),
});
type Queue = z.infer<typeof queueSchema> & { warning?: string };

async function readQueue(signal: AbortSignal, accountId: string | null): Promise<Queue> {
  const response = await fetch("/api/moderation", {
    cache: "no-store",
    signal,
    headers: accountId ? { "X-AIVerse-Account": accountId } : {},
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      result && typeof result === "object" && "error" in result && typeof result.error === "string"
        ? result.error
        : "The review queue could not be loaded. Refresh the queue to try again.",
    );
  const envelope = z
    .object({
      roles: z.array(z.string()),
      versions: z.array(z.unknown()),
      applications: z.array(z.unknown()),
    })
    .parse(result);
  const versions = envelope.versions.flatMap((row) => {
    const parsed = queueSchema.shape.versions.element.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
  const applications = envelope.applications.flatMap((row) => {
    const parsed = queueSchema.shape.applications.element.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
  const warning =
    versions.length !== envelope.versions.length ||
    applications.length !== envelope.applications.length
      ? "Some submissions could not be displayed and need operator repair. Valid submissions are listed below."
      : undefined;
  return { roles: envelope.roles, versions, applications, warning };
}

type Decision = z.infer<typeof decisionInput>;
function DecisionForm({
  kind,
  id,
  title,
  disabled,
  onDecision,
}: {
  kind: "application" | "version" | "video";
  id?: string;
  title: string;
  disabled: boolean;
  onDecision: (decision: Decision) => Promise<string | null>;
}) {
  const messageId = useId();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || pending.current || !alive.current) return;
    const form = new FormData(event.currentTarget);
    const decision = form.get("decision");
    const value = decisionInput.safeParse({
      kind,
      id: id ?? form.get("id"),
      reason: form.get("reason"),
      ...(kind === "video" ? { action: decision } : { approve: decision === "approve" }),
    });
    if (
      !(kind === "video"
        ? decision === "hide" || decision === "remove"
        : decision === "approve" || decision === "reject") ||
      !value.success
    ) {
      setMessage("Choose a decision and enter a reason of 5 to 1000 characters.");
      return;
    }
    pending.current = true;
    setBusy(true);
    setMessage("");
    try {
      const failure = await onDecision(value.data);
      if (alive.current && failure) setMessage(failure);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <form
      className="studio-form studio-decision"
      onSubmit={submit}
      aria-label={`Decision for ${title}`}
    >
      <fieldset disabled={busy || disabled}>
        {kind === "video" && (
          <label>
            Film ID
            <input
              name="id"
              required
              pattern="[a-fA-F0-9-]{36}"
              maxLength={36}
              autoComplete="off"
            />
          </label>
        )}
        <label>
          Decision
          <select name="decision" required defaultValue="">
            <option value="" disabled>
              Choose a decision
            </option>
            {kind === "video" ? (
              <>
                <option value="hide">Hide film</option>
                <option value="remove">Remove film and queue media deletion</option>
              </>
            ) : (
              <>
                <option value="approve">
                  {kind === "application"
                    ? "Approve creator application"
                    : "Approve and publish this revision"}
                </option>
                <option value="reject">
                  {kind === "application" ? "Reject application" : "Reject this revision"}
                </option>
              </>
            )}
          </select>
        </label>
        <label>
          Reason
          <textarea
            name="reason"
            required
            minLength={5}
            maxLength={1000}
            rows={3}
            aria-describedby={message ? messageId : undefined}
          />
        </label>
        <button className="button primary" disabled={busy || disabled}>
          {busy ? "Recording decision…" : "Record decision"}
        </button>
      </fieldset>
      {message && (
        <p id={messageId} className="error-message" role="alert">
          {message}
        </p>
      )}
    </form>
  );
}

export function ModerationPanel({ configured }: { configured: boolean }) {
  const appearance = useAppearance();
  const [accountId, setAccountId] = useState<string | null>(
    appearance.ready ? appearance.accountId : null,
  );
  // Focus/visibility reads temporarily clear appearance identity. Keep the
  // confirmed owner (and their draft) until another identity is confirmed.
  // Explicit identity events still immediately invalidate the child session.
  if (appearance.ready && accountId !== appearance.accountId) setAccountId(appearance.accountId);
  return (
    <ModerationSession
      key={`${configured}:${accountId ?? "guest"}`}
      configured={configured}
      accountId={accountId}
    />
  );
}

function ModerationSession({
  configured,
  accountId,
}: {
  configured: boolean;
  accountId: string | null;
}) {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [loading, setLoading] = useState(configured);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [artworkReady, setArtworkReady] = useState<Record<string, boolean>>({});
  const artworkStatus = useRef<Record<string, boolean>>({});
  const active = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const identityInvalidated = useRef(false);
  const refreshButton = useRef<HTMLButtonElement | null>(null);
  const current = (controller: AbortController) =>
    alive.current && active.current === controller && !controller.signal.aborted;
  async function refresh() {
    if (!configured || active.current || !alive.current) return;
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const result = await readQueue(
        AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        accountId,
      );
      if (current(controller)) {
        identityInvalidated.current = false;
        setQueue(accountId ? result : null);
        if (!accountId) setError("Sign in with moderator access to load the private review queue.");
      }
    } catch {
      if (current(controller)) {
        setQueue(null);
        setError(
          "The review queue could not be loaded. Refresh the queue to try again, or check your moderator access.",
        );
      }
    } finally {
      if (current(controller)) {
        active.current = null;
        setLoading(false);
      }
    }
  }
  async function record(decision: Decision): Promise<string | null> {
    if (!alive.current || identityInvalidated.current || !accountId)
      return "Your session changed. Refresh the queue before reviewing.";
    if (active.current) return "Wait for the current review action to finish.";
    if (decision.kind === "version" && artworkStatus.current[decision.id] !== true)
      return "Load this revision's thumbnail or confirm that no thumbnail was supplied before deciding.";
    const controller = new AbortController();
    active.current = controller;
    setWorking(true);
    setError("");
    setNotice("");
    let restoreFocus = false;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
    try {
      const response = await fetch("/api/moderation/decisions", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          ...(accountId ? { "X-AIVerse-Account": accountId } : {}),
        },
        body: JSON.stringify(decision),
        signal,
      });
      const result: unknown = await response.json().catch(() => null);
      if (!current(controller)) return null;
      if (!response.ok || !z.object({ ok: z.literal(true) }).safeParse(result).success) {
        if (response.status === 401 || response.status === 403 || response.status === 409) {
          restoreFocus = true;
          setQueue(null);
          setError(
            "Your access or this submission changed. Refresh the queue before making another decision.",
          );
          return null;
        }
        return "The decision could not be confirmed. Your input is kept. Refresh the queue before retrying.";
      }
      restoreFocus = true;
      setQueue(null);
      setNotice("Decision recorded. Refreshing the queue...");
      setLoading(true);
      // Do not unlock another mutation until the fresh queue has settled.
      try {
        const result = await readQueue(
          AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
          accountId,
        );
        if (current(controller)) {
          setQueue(result);
          setNotice("Decision recorded. The review queue is up to date.");
        }
      } catch {
        if (current(controller)) {
          setNotice("Decision recorded.");
          setError(
            "The decision was saved, but the queue could not reload. Refresh the queue before continuing.",
          );
        }
      }
      return null;
    } catch {
      return current(controller)
        ? "The decision could not be confirmed. Your input is kept. Refresh the queue before retrying."
        : null;
    } finally {
      if (current(controller)) {
        active.current = null;
        setWorking(false);
        setLoading(false);
        if (restoreFocus)
          window.requestAnimationFrame(() => {
            if (alive.current && !active.current) refreshButton.current?.focus();
          });
      }
    }
  }
  useEffect(() => {
    alive.current = true;
    const invalidate = () => {
      identityInvalidated.current = true;
      active.current?.abort();
      active.current = null;
      setQueue(null);
      setLoading(false);
      setWorking(false);
      setNotice("");
      setError("Your session changed. Refresh the queue after signing in with moderator access.");
    };
    window.addEventListener(accountChangedEvent, invalidate);
    window.addEventListener(accountUnavailableEvent, invalidate);
    void Promise.resolve().then(() => {
      if (alive.current) return refresh();
    });
    return () => {
      alive.current = false;
      active.current?.abort();
      active.current = null;
      window.removeEventListener(accountChangedEvent, invalidate);
      window.removeEventListener(accountUnavailableEvent, invalidate);
    };
    // This session is keyed to the configured backend and private identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="studio-panel" aria-busy={loading || working}>
      {!configured ? (
        <p className="demo-callout">
          Account services are not configured. Private review queues will become available to
          authorized moderators after setup.
        </p>
      ) : (
        <div className="studio-toolbar">
          <button
            className="button secondary"
            type="button"
            ref={refreshButton}
            disabled={loading || working}
            onClick={() => void refresh()}
          >
            {loading ? "Loading review queue…" : "Refresh queue"}
          </button>
          <Link className="text-link" href="/login">
            Sign in
          </Link>
        </div>
      )}
      {notice && (
        <p className="field-description" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {loading && (
        <p className="field-description" role="status">
          Loading pending revisions and authorized application reviews…
        </p>
      )}
      {queue && (
        <>
          {queue.warning && (
            <p className="error-message" role="alert">
              {queue.warning}
            </p>
          )}
          <section className="studio-section" aria-labelledby="film-review-heading">
            <h2 id="film-review-heading">Films awaiting review</h2>
            <p className="field-description">
              Review the exact file, thumbnail, metadata, rights declaration and AI disclosure
              before publishing. A decision applies only to this revision.
            </p>
            {!queue.versions.length ? (
              <p className="studio-status">
                No films are awaiting review. Refresh the queue after a creator’s upload finishes
                processing.
              </p>
            ) : (
              <div className="studio-list">
                {queue.versions.map((version) => (
                  <article key={version.id} className="studio-row">
                    <div className="studio-row-heading">
                      <h3>{version.metadata.title}</h3>
                      <span className="studio-state">Revision {version.revision}</span>
                    </div>
                    <p>{version.metadata.description}</p>
                    <dl className="studio-metadata">
                      <div>
                        <dt>Format</dt>
                        <dd>{version.metadata.format === "reel" ? "Reel" : "Movie"}</dd>
                      </div>
                      <div>
                        <dt>Duration</dt>
                        <dd>
                          {version.duration_seconds === null
                            ? "Not available"
                            : `${version.duration_seconds} seconds`}
                        </dd>
                      </div>
                      <div>
                        <dt>Genres</dt>
                        <dd>{version.metadata.genres.join(", ")}</dd>
                      </div>
                      <div>
                        <dt>Content inspiration</dt>
                        <dd>{version.metadata.regions.join(", ")}</dd>
                      </div>
                      <div>
                        <dt>Languages</dt>
                        <dd>{version.metadata.languages.join(", ")}</dd>
                      </div>
                      <div>
                        <dt>Tags</dt>
                        <dd>{version.metadata.tags.join(", ") || "None"}</dd>
                      </div>
                      <div>
                        <dt>AI disclosure</dt>
                        <dd>{version.metadata.ai_disclosed ? "Confirmed" : "Missing"}</dd>
                      </div>
                      <div>
                        <dt>Rights declaration</dt>
                        <dd>{version.metadata.rights_declaration}</dd>
                      </div>
                    </dl>
                    {accountId && (
                      <VersionArtworkPreview
                        versionId={version.id}
                        accountId={accountId}
                        enabled={!loading && !working}
                        onReadyChange={(ready) => {
                          if (artworkStatus.current[version.id] === ready) return;
                          artworkStatus.current[version.id] = ready;
                          setArtworkReady((previous) => ({ ...previous, [version.id]: ready }));
                        }}
                      />
                    )}
                    <FilmPlayer
                      videoId={version.video_id}
                      versionId={version.id}
                      title={version.metadata.title}
                    />
                    <DecisionForm
                      kind="version"
                      id={version.id}
                      title={version.metadata.title}
                      disabled={loading || working || artworkReady[version.id] !== true}
                      onDecision={record}
                    />
                  </article>
                ))}
              </div>
            )}
          </section>
          {queue.roles.includes("admin") && (
            <section className="studio-section" aria-labelledby="application-review-heading">
              <h2 id="application-review-heading">Creator applications</h2>
              <p className="field-description">
                Administrator approval grants creator access. Moderator access alone cannot grant
                roles.
              </p>
              {!queue.applications.length ? (
                <p className="studio-status">No creator applications are awaiting a decision.</p>
              ) : (
                <div className="studio-list">
                  {queue.applications.map((application) => {
                    let portfolio: string | null = null;
                    try {
                      const url = new URL(application.application.portfolio_url);
                      if (url.protocol === "https:" && !url.username && !url.password)
                        portfolio = url.toString();
                    } catch {
                      /* Unsafe portfolio links remain plain metadata. */
                    }
                    return (
                      <article className="studio-row" key={application.id}>
                        <h3>{application.application.display_name}</h3>
                        <p className="studio-hint">@{application.application.handle}</p>
                        <p>{application.application.bio}</p>
                        {portfolio ? (
                          <a
                            className="text-link"
                            href={portfolio}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            Open creator portfolio
                          </a>
                        ) : (
                          <p className="error-message">
                            Portfolio link is unavailable. Request a corrected application.
                          </p>
                        )}
                        <DecisionForm
                          kind="application"
                          id={application.id}
                          title={application.application.display_name}
                          disabled={loading || working}
                          onDecision={record}
                        />
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}
          <section className="studio-section">
            <details>
              <summary>Hide or remove a film</summary>
              <p className="field-description">
                Hiding stops new discovery and playback grants. Removal also queues media deletion.
                Existing playback sessions have a bounded access window.
              </p>
              <DecisionForm
                kind="video"
                title="film removal"
                disabled={loading || working}
                onDecision={record}
              />
            </details>
          </section>
        </>
      )}
      {!queue && !loading && (
        <p className="supporting-note">
          This page does not display sample private records. Sign in with an authorized moderator or
          administrator account to review real submissions.
        </p>
      )}
    </div>
  );
}
