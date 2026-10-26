"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { genreSlugs, regionSlugs } from "@/features/preferences/schema";
import { languageSlugs } from "@/features/discovery/query";
import { label } from "@/features/discovery/catalog";
import { versionInput } from "@/features/media/schema";
import { FilmPlayer } from "./film-player";
import { StorageUploadForm } from "./storage-upload-form";
import { VersionArtwork } from "./version-artwork";
import { useAppearance } from "./appearance-provider";
import { accountChangedEvent, accountUnavailableEvent } from "@/lib/appearance";

const studioSchema = z.object({
  eligible: z.boolean(),
  videos: z.array(
    z.object({
      id: z.uuid(),
      state: z.string(),
      latest_version_id: z.uuid().nullable(),
      active_version_id: z.uuid().nullable(),
    }),
  ),
  versions: z.array(
    z.object({
      id: z.uuid(),
      video_id: z.uuid(),
      revision: z.number(),
      metadata: versionInput.shape.metadata,
      state: z.string(),
      duration_seconds: z.number().nullable(),
      created_at: z.string(),
    }),
  ),
});
type StudioData = z.infer<typeof studioSchema>;
class StudioRequestError extends Error {
  constructor(readonly status: number) {
    super("The Studio request could not be confirmed.");
  }
}
const accessChanged = (error: unknown) =>
  error instanceof StudioRequestError && [401, 403, 409].includes(error.status);
const accessMessage = (error: unknown) => {
  if (!(error instanceof StudioRequestError)) return "";
  if (error.status === 401)
    return "Your session expired. Sign in again, then refresh the studio. Your draft input is kept for this account.";
  if (error.status === 403)
    return "This request was denied. Verify your email or check whether upload access is suspended, then refresh the studio.";
  return "Your account access or revision status changed. Refresh the studio before continuing.";
};

async function requestJson(
  path: string,
  accountId: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(path, {
    cache: "no-store",
    signal,
    headers: {
      "X-AIVerse-Account": accountId,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
  });
  const result: unknown = await response.json().catch(() => null);
  if (signal?.aborted) throw new Error("The Studio request was cancelled.");
  if (!response.ok) throw new StudioRequestError(response.status);
  return result;
}

async function readStudio(accountId: string, signal: AbortSignal) {
  return studioSchema.parse(await requestJson("/api/studio", accountId, undefined, signal));
}

function TaxonomyChoices({
  name,
  heading,
  items,
  hint,
}: {
  name: string;
  heading: string;
  items: readonly string[];
  hint: string;
}) {
  return (
    <fieldset className="studio-choices">
      <legend>{heading}</legend>
      <p className="field-description">{hint}</p>
      <div className="studio-checkbox-grid">
        {items.map((value) => (
          <label key={value}>
            <input type="checkbox" name={name} value={value} />
            <span>{label(value)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function StudioPanel({
  configured,
  uploadsEnabled,
}: {
  configured: boolean;
  uploadsEnabled: boolean;
}) {
  const appearance = useAppearance();
  const [accountId, setAccountId] = useState<string | null>(
    appearance.ready ? appearance.accountId : null,
  );
  // A focus/theme read temporarily clears identity. Preserve the confirmed
  // owner until a new identity or explicit invalidation is confirmed.
  if (appearance.ready && accountId !== appearance.accountId) setAccountId(appearance.accountId);
  return (
    <StudioSession
      key={`${configured}:${accountId ?? "guest"}`}
      configured={configured}
      uploadsEnabled={uploadsEnabled}
      accountId={accountId}
    />
  );
}
function StudioSession({
  configured,
  uploadsEnabled,
  accountId,
}: {
  configured: boolean;
  uploadsEnabled: boolean;
  accountId: string | null;
}) {
  const [data, setData] = useState<StudioData | null>(null);
  const [draftOpened, setDraftOpened] = useState(false);
  const draftForm = useRef<HTMLFormElement>(null);
  const [loading, setLoading] = useState(configured && !!accountId);
  const [busy, setBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [available, setAvailable] = useState(false);
  const [accessLost, setAccessLost] = useState(false);
  const availability = useRef(false);
  const confirmAvailable = (next: boolean) => {
    availability.current = next;
    setAvailable(next);
  };
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const active = useRef<AbortController | null>(null);
  const transferOwner = useRef<string | null>(null);
  const alive = useRef(true);
  const identityInvalidated = useRef(false);
  const current = (controller: AbortController) =>
    alive.current &&
    !identityInvalidated.current &&
    active.current === controller &&
    !controller.signal.aborted;
  function clearPrivateAccess() {
    identityInvalidated.current = true;
    setAccessLost(true);
    setData(null);
    confirmAvailable(false);
    setSuccess("");
  }
  function transferBusy(owner: string, next: boolean) {
    if (!alive.current) return false;
    if (next) {
      if (
        !availability.current ||
        !accountId ||
        identityInvalidated.current ||
        active.current ||
        transferOwner.current
      )
        return false;
      transferOwner.current = owner;
      setUploadBusy(true);
      return true;
    }
    if (transferOwner.current === owner) {
      transferOwner.current = null;
      setUploadBusy(false);
    }
    return true;
  }
  async function refresh() {
    if (!configured || !accountId || active.current || transferOwner.current || !alive.current)
      return;
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    confirmAvailable(false);
    setError("");
    try {
      const value = await readStudio(
        accountId,
        AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      );
      if (alive.current && active.current === controller && !controller.signal.aborted) {
        identityInvalidated.current = false;
        setAccessLost(false);
        setData(value);
        if (value.eligible) setDraftOpened(true);
        confirmAvailable(value.eligible);
      }
    } catch (failure) {
      if (alive.current && active.current === controller && !controller.signal.aborted) {
        if (accessChanged(failure)) clearPrivateAccess();
        setError(
          accessChanged(failure)
            ? accessMessage(failure)
            : "Studio could not reload. Your current input is kept. Refresh status after checking your connection and signed-in account.",
        );
      }
    } finally {
      if (alive.current && active.current === controller && !controller.signal.aborted) {
        active.current = null;
        setLoading(false);
      }
    }
  }
  useEffect(() => {
    alive.current = true;
    const invalidate = () => {
      if (!accountId) return;
      identityInvalidated.current = true;
      setAccessLost(true);
      active.current?.abort();
      active.current = null;
      transferOwner.current = null;
      setData(null);
      draftForm.current?.reset();
      setDraftOpened(false);
      confirmAvailable(false);
      setBusy(false);
      setLoading(false);
      setUploadBusy(false);
      setSuccess("");
      setError("Your account changed. Refresh the studio after signing in.");
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
    // Private state is keyed to the configured backend and confirmed owner.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function mutate(path: string, body: unknown, successMessage: string, onSaved?: () => void) {
    if (
      !accountId ||
      !availability.current ||
      !alive.current ||
      identityInvalidated.current ||
      active.current ||
      transferOwner.current
    )
      return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await requestJson(
        path,
        accountId,
        body,
        AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      );
      if (!current(controller)) return;
      z.object({ version: z.object({ video_id: z.uuid(), version_id: z.uuid() }) }).parse(result);
      onSaved?.();
      setSuccess(successMessage);
      confirmAvailable(false);
      setLoading(true);
      try {
        const value = await readStudio(
          accountId,
          AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        );
        if (current(controller)) {
          setData(value);
          confirmAvailable(value.eligible);
        }
      } catch (failure) {
        if (current(controller)) {
          if (accessChanged(failure)) clearPrivateAccess();
          setError(
            accessChanged(failure)
              ? `Your change was saved. ${accessMessage(failure)}`
              : "Your change was saved, but Studio could not reload. Refresh status before continuing.",
          );
        }
      }
    } catch (failure) {
      if (current(controller)) {
        if (accessChanged(failure)) clearPrivateAccess();
        confirmAvailable(false);
        setError(
          accessChanged(failure)
            ? accessMessage(failure)
            : "The change could not be confirmed. Your input is kept. Refresh status before submitting again; no retry was started.",
        );
      }
    } finally {
      if (alive.current && active.current === controller && !controller.signal.aborted) {
        active.current = null;
        setBusy(false);
        setLoading(false);
      }
    }
  }
  async function saveDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const input = versionInput.safeParse({
      videoId: form.get("videoId") || null,
      metadata: {
        title: form.get("title"),
        description: form.get("description"),
        format: form.get("format"),
        genres: form.getAll("genres"),
        regions: form.getAll("regions"),
        languages: form.getAll("languages"),
        tags: String(form.get("tags") ?? "")
          .split(",")
          .map((tag) => tag.trim().toLowerCase().replace(/^#/, ""))
          .filter(Boolean),
        ai_disclosed: form.get("ai_disclosed") === "on",
        rights_attested: form.get("rights_attested") === "on",
        rights_declaration: form.get("rights_declaration"),
      },
    });
    if (!input.success) {
      setError(
        "Check each field: choose 1–8 genres, content inspiration and languages; add valid tags, both confirmations, and a rights declaration of at least 20 characters.",
      );
      return;
    }
    if (input.data.metadata.tags.length > 10) {
      setError("Use at most 10 tags.");
      return;
    }
    await mutate(
      "/api/studio/versions",
      input.data,
      "Your revision is saved privately. Select its file below when uploads are enabled.",
      () => formElement.reset(),
    );
  }

  return (
    <div className="studio-panel" aria-busy={loading || busy || uploadBusy}>
      {!configured && (
        <p className="demo-callout">
          Account services are not configured yet. Connect account services to prepare your videos.
        </p>
      )}
      {configured && !accountId && (
        <p className="field-description">
          Sign in to prepare your videos and manage private film revisions.
        </p>
      )}
      {configured && (
        <div className="studio-toolbar">
          <button
            type="button"
            className="button secondary"
            disabled={!accountId || loading || busy || uploadBusy}
            onClick={() => void refresh()}
          >
            {loading ? "Loading your studio…" : "Refresh status"}
          </button>
          {(!accountId || accessLost) && (
            <Link className="text-link" href="/login">
              Sign in
            </Link>
          )}
        </div>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="success-message" role="status">
          {success}
        </p>
      )}
      {loading && (
        <p className="field-description" role="status">
          Loading your film revisions…
        </p>
      )}
      {data && !data.eligible && (
        <p className="error-message" role="alert">
          Upload access is suspended for this account. You can still view your private revisions.
        </p>
      )}
      {data?.eligible && !uploadsEnabled && (
        <p className="field-description">
          Video transfer is unavailable because the video service is not configured. You can still
          prepare private revisions; publication requires review.
        </p>
      )}
      {(draftOpened || data) && (
        <>
          <section hidden={!draftOpened} className="studio-section" aria-labelledby="draft-heading">
            <h2 id="draft-heading">Create a film revision</h2>
            <p className="field-description">
              Every revision is private until its specific file and details pass review. A published
              version keeps its approved details while a new revision is reviewed.
            </p>
            <form ref={draftForm} className="studio-form" onSubmit={saveDraft}>
              <fieldset disabled={!available || busy || loading || uploadBusy}>
                <label>
                  Film
                  <select name="videoId">
                    <option value="">New film</option>
                    {data?.videos
                      .filter((video) => !["removed", "hidden"].includes(video.state))
                      .map((video) => (
                        <option key={video.id} value={video.id}>
                          {data.versions.find((version) => version.video_id === video.id)?.metadata
                            .title ?? video.id}
                        </option>
                      ))}
                  </select>
                  <span className="studio-hint">
                    Select an existing film to save a new immutable revision.
                  </span>
                </label>
                <label>
                  Title
                  <input name="title" required maxLength={160} />
                </label>
                <label>
                  Description
                  <textarea name="description" required maxLength={3000} rows={5} />
                </label>
                <label>
                  Format
                  <select name="format">
                    <option value="reel">Reel</option>
                    <option value="movie">Movie (up to 20 minutes)</option>
                  </select>
                </label>
                <TaxonomyChoices
                  name="genres"
                  heading="Genres"
                  items={genreSlugs}
                  hint="Choose 1–12 genres that describe this film."
                />
                <TaxonomyChoices
                  name="regions"
                  heading="Content inspiration"
                  items={regionSlugs}
                  hint="Choose at least one. These describe the work, never anyone’s ethnicity."
                />
                <TaxonomyChoices
                  name="languages"
                  heading="Languages"
                  items={languageSlugs}
                  hint="Choose the actual language or languages of the film; choose Silent when appropriate."
                />
                <label>
                  Tags, separated by commas
                  <input name="tags" maxLength={400} placeholder="space, garden, hope" />
                  <span className="studio-hint">
                    Up to 10 lowercase tags; letters, numbers and hyphens.
                  </span>
                </label>
                <label>
                  Rights declaration
                  <textarea
                    name="rights_declaration"
                    required
                    minLength={20}
                    maxLength={1000}
                    rows={3}
                  />
                  <span className="studio-hint">
                    Explain your rights to the imagery, voices, music and any source material.
                  </span>
                </label>
                <label className="studio-confirmation">
                  <input type="checkbox" name="ai_disclosed" required />
                  <span>This film uses AI-generated content, and I agree to disclose it.</span>
                </label>
                <label className="studio-confirmation">
                  <input type="checkbox" name="rights_attested" required />
                  <span>I have permission to upload and distribute every part of this film.</span>
                </label>
                <button
                  className="button primary"
                  disabled={!available || busy || loading || uploadBusy}
                >
                  {busy ? "Saving revision…" : "Save private revision"}
                </button>
              </fieldset>
            </form>
          </section>
          <section className="studio-section" aria-labelledby="revisions-heading">
            <h2 id="revisions-heading">Your revisions</h2>
            {!data?.versions.length ? (
              <p className="field-description">
                Save your first revision above. It will appear here with its upload and review
                status.
              </p>
            ) : (
              <div className="studio-list">
                {data.versions.map((version) => (
                  <article className="studio-row" key={version.id}>
                    <div className="studio-row-heading">
                      <h3>{version.metadata.title}</h3>
                      <span className="studio-state">
                        Revision {version.revision} · {version.state.replaceAll("_", " ")}
                      </span>
                    </div>
                    <p>{version.metadata.description}</p>
                    <p className="studio-hint">
                      {version.metadata.genres.map(label).join(", ")} ·{" "}
                      {version.metadata.format === "reel" ? "Reel" : "Movie"}
                    </p>
                    {["draft", "uploading"].includes(version.state) &&
                      data.videos.find((video) => video.id === version.video_id)
                        ?.latest_version_id === version.id && (
                        <>
                          {version.state === "draft" && (
                            <VersionArtwork
                              versionId={version.id}
                              accountId={accountId!}
                              enabled={available && !loading && !busy && !uploadBusy}
                              onBusyChange={(next) => transferBusy(`${version.id}:artwork`, next)}
                            />
                          )}
                          <StorageUploadForm
                            key={`${accountId}:${version.id}`}
                            versionId={version.id}
                            accountId={accountId!}
                            providerEnabled={uploadsEnabled}
                            recovering={version.state === "uploading"}
                            enabled={
                              uploadsEnabled && available && !loading && !busy && !uploadBusy
                            }
                            onBusyChange={(next) => transferBusy(`${version.id}:upload`, next)}
                            onUploaded={() =>
                              setSuccess(
                                "The uploaded file passed inspection and is waiting for human review. Refresh status to see the revision.",
                              )
                            }
                          />
                        </>
                      )}
                    {["uploading", "processing"].includes(version.state) && (
                      <p className="field-description">
                        Use Check uploaded file to confirm a completed transfer, or Refresh status
                        to read the latest result. No additional upload starts automatically.
                      </p>
                    )}
                    {["pending_review", "published"].includes(version.state) && (
                      <FilmPlayer
                        videoId={version.video_id}
                        versionId={version.id}
                        title={version.metadata.title}
                      />
                    )}
                    {["failed", "rejected"].includes(version.state) && (
                      <p className="field-description">
                        Save a new revision above to submit a replacement for review.
                      </p>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
