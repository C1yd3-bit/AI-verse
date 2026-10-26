"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { accountChangedEvent, accountUnavailableEvent } from "@/lib/appearance";
import { getSupabaseConfig } from "@/lib/env";
import {
  parseStorageCompletion,
  parseStorageGrant,
  parseStorageRecovery,
  readStorageJournal,
  readStorageResponse,
  transferStorageVideo,
  validStorageFile,
  writeStorageJournal,
  type StorageUploadJournal,
} from "@/features/media/storage-upload-client";

type Phase =
  "checking" | "idle" | "authorizing" | "uploading" | "confirming" | "blocked" | "complete";
class StorageRequestError extends Error {
  constructor(readonly status: number) {
    super("Storage request denied.");
  }
}
const recoveryMessage =
  "The upload is not confirmed. Some bytes may have reached Storage. Check the uploaded file below; no new upload starts automatically.";

export function StorageUploadForm({
  versionId,
  accountId,
  enabled,
  providerEnabled = true,
  recovering = false,
  onUploaded,
  onBusyChange,
}: {
  versionId: string;
  accountId: string;
  enabled: boolean;
  providerEnabled?: boolean;
  recovering?: boolean;
  onUploaded: () => void;
  onBusyChange: (busy: boolean) => boolean | void;
}) {
  const progressId = useId();
  const messageId = useId();
  const [phase, setPhase] = useState<Phase>("checking");
  const [message, setMessage] = useState("");
  const [percentage, setPercentage] = useState<number | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [canRecover, setCanRecover] = useState(false);
  const active = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const invalidated = useRef(false);
  const ownsBusy = useRef(false);
  const journal = useRef<StorageUploadJournal | null>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const configuredUrl = getSupabaseConfig()?.url ?? null;
  const busy = ["authorizing", "uploading", "confirming"].includes(phase);
  const current = (controller: AbortController) =>
    alive.current &&
    !invalidated.current &&
    active.current === controller &&
    !controller.signal.aborted;
  const release = () => {
    if (ownsBusy.current) {
      ownsBusy.current = false;
      onBusyChange(false);
    }
  };
  const focusFeedback = () =>
    window.requestAnimationFrame?.(() => {
      if (alive.current && !invalidated.current) feedback.current?.focus();
    });
  const remember = (entry: StorageUploadJournal) => {
    writeStorageJournal(sessionStorage, accountId, versionId, entry);
    journal.current = entry;
  };
  const failureMessage = (failure: unknown) =>
    failure instanceof StorageRequestError && failure.status === 401
      ? "Your session expired. Sign in again, then refresh the studio before checking this upload."
      : failure instanceof StorageRequestError && failure.status === 403
        ? "This account cannot complete the upload. Check your verified email and upload restrictions, then refresh the studio."
        : recoveryMessage;

  async function request(
    path: string,
    controller: AbortController,
    body?: unknown,
    timeout = 15000,
  ) {
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeout)]);
    const response = await fetch(path, {
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      signal,
      headers: {
        "X-AIVerse-Account": accountId,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
    });
    const result = await readStorageResponse(response, signal);
    if (!response.ok) throw new StorageRequestError(response.status);
    return result;
  }

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    active.current = controller;
    const invalidate = () => {
      invalidated.current = true;
      active.current?.abort();
      active.current = null;
      release();
      setPhase("blocked");
      setCanRecover(false);
      setMessage("Your account changed. Refresh the studio before continuing.");
    };
    window.addEventListener(accountChangedEvent, invalidate);
    window.addEventListener(accountUnavailableEvent, invalidate);
    void Promise.resolve().then(async () => {
      if (!current(controller)) return;
      try {
        journal.current = readStorageJournal(sessionStorage, accountId, versionId);
        if (!providerEnabled || !configuredUrl) {
          setPhase("blocked");
          setMessage("Storage uploads are not configured. Your private revision remains saved.");
          return;
        }
        const result = parseStorageRecovery(
          await request(
            `/api/studio/uploads?versionId=${encodeURIComponent(versionId)}`,
            controller,
          ),
          accountId,
          versionId,
        );
        if (!current(controller)) return;
        if (result.status === "pending_review") {
          setPhase("complete");
          setMessage("This file passed inspection and is waiting for human review.");
        } else if (result.status === "reserved") {
          remember({
            requestKey: journal.current?.requestKey ?? crypto.randomUUID(),
            reservationId: result.reservationId,
            phase: "uncertain",
          });
          setCanRecover(true);
          setPhase("blocked");
          setMessage(recoveryMessage);
        } else if (result.status === "failed") {
          setPhase("blocked");
          setMessage(
            "This upload did not pass inspection. Save a new private revision before choosing another file.",
          );
        } else if (journal.current || recovering) {
          setPhase("blocked");
          setMessage(
            "An earlier upload attempt could not be confirmed. Refresh status or save a new revision before another upload.",
          );
        } else setPhase("idle");
      } catch (failure) {
        if (current(controller)) {
          setPhase("blocked");
          setNeedsLogin(failure instanceof StorageRequestError && failure.status === 401);
          setMessage(
            failure instanceof StorageRequestError
              ? failureMessage(failure)
              : "Upload status could not be checked. Enable browser session storage, check your connection and refresh the studio.",
          );
        }
      } finally {
        if (active.current === controller) active.current = null;
      }
    });
    return () => {
      alive.current = false;
      active.current?.abort();
      active.current = null;
      release();
      window.removeEventListener(accountChangedEvent, invalidate);
      window.removeEventListener(accountUnavailableEvent, invalidate);
    };
    // Parent keys each form to its confirmed owner and immutable version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, versionId]);

  async function confirm(reservationId: string, controller: AbortController) {
    setPhase("confirming");
    const result = await request(
      "/api/studio/uploads/complete",
      controller,
      { reservationId, versionId },
      90000,
    );
    parseStorageCompletion(result, accountId, versionId, reservationId);
    if (!current(controller)) return;
    if (journal.current) remember({ ...journal.current, reservationId, phase: "complete" });
    setCanRecover(false);
    setPhase("complete");
    setMessage("Your file passed inspection and is waiting for human review. It is still private.");
    onUploaded();
    focusFeedback();
  }
  function begin() {
    if (!enabled || !alive.current || invalidated.current || active.current || ownsBusy.current)
      return null;
    if (onBusyChange(true) === false) return null;
    ownsBusy.current = true;
    const controller = new AbortController();
    active.current = controller;
    setNeedsLogin(false);
    setMessage("");
    return controller;
  }
  function failed(failure: unknown, controller: AbortController) {
    try {
      if (journal.current) remember({ ...journal.current, phase: "uncertain" });
    } catch {
      /* The pre-request latch still prevents a new capability. */
    }
    if (!current(controller)) return;
    setPhase("blocked");
    setCanRecover(journal.current?.reservationId != null);
    setNeedsLogin(failure instanceof StorageRequestError && failure.status === 401);
    setMessage(failureMessage(failure));
    focusFeedback();
  }
  function finish(controller: AbortController) {
    if (active.current === controller) {
      active.current = null;
      release();
    }
  }
  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase !== "idle" || journal.current || !configuredUrl) return;
    const file = new FormData(event.currentTarget).get("file");
    if (!validStorageFile(file)) {
      setMessage("Choose an MP4 file no larger than 50 MB (50,000,000 bytes).");
      return;
    }
    const controller = begin();
    if (!controller) return;
    try {
      // Persist before authorization. A reload cannot silently issue another grant.
      if (readStorageJournal(sessionStorage, accountId, versionId))
        throw new Error("Earlier upload attempt exists.");
      const requestKey = crypto.randomUUID();
      remember({ requestKey, reservationId: null, phase: "started" });
      setPhase("authorizing");
      const raw = await request("/api/studio/uploads", controller, {
        versionId,
        idempotencyKey: requestKey,
        fileSize: file.size,
      });
      if (!current(controller)) return;
      const grant = parseStorageGrant(raw, accountId, versionId, configuredUrl, file.size);
      remember({ requestKey, reservationId: grant.reservationId, phase: "started" });
      setCanRecover(true);
      setPhase("uploading");
      setPercentage(null);
      await transferStorageVideo({
        grant,
        configuredUrl,
        file,
        signal: controller.signal,
        onProgress: (value) => {
          if (current(controller)) setPercentage(value);
        },
      });
      if (!current(controller)) return;
      remember({ requestKey, reservationId: grant.reservationId, phase: "sent" });
      await confirm(grant.reservationId, controller);
    } catch (failure) {
      failed(failure, controller);
    } finally {
      finish(controller);
    }
  }
  async function recover() {
    const reservationId = journal.current?.reservationId;
    if (!canRecover || !reservationId || !["blocked"].includes(phase)) return;
    const controller = begin();
    if (!controller) return;
    try {
      await confirm(reservationId, controller);
    } catch (failure) {
      failed(failure, controller);
    } finally {
      finish(controller);
    }
  }
  function cancel() {
    if (!active.current) return;
    active.current.abort();
    active.current = null;
    release();
    try {
      if (journal.current) remember({ ...journal.current, phase: "uncertain" });
    } catch {
      /* Pre-request latch remains. */
    }
    setPhase("blocked");
    setCanRecover(journal.current?.reservationId != null);
    setMessage(
      "Upload cancelled. Some bytes may have reached Storage. Check the uploaded file before continuing; no retry starts automatically.",
    );
    focusFeedback();
  }

  return (
    <form className="studio-upload" onSubmit={upload} aria-busy={busy || phase === "checking"}>
      <label>
        Video file
        <input
          name="file"
          type="file"
          accept=".mp4,video/mp4"
          required
          disabled={!enabled || phase !== "idle"}
          aria-describedby={message ? messageId : undefined}
        />
      </label>
      <p className="field-description">
        MP4 only, up to 50 MB. Reels can run up to 3 minutes; Movies up to 20 minutes. The file
        stays private until inspection and human review are complete.
      </p>
      {phase === "checking" && (
        <p className="field-description" role="status">
          Checking this revision’s upload status…
        </p>
      )}
      {phase === "authorizing" && (
        <p className="field-description" role="status">
          Authorizing private Storage upload…
        </p>
      )}
      {phase === "uploading" && (
        <div className="studio-upload-progress">
          <label htmlFor={progressId}>
            Uploading file{percentage === null ? "…" : ` · ${percentage}%`}
          </label>
          <progress id={progressId} max={100} value={percentage ?? undefined} />
          <p className="field-description">
            Transfer progress only. File inspection and review follow.
          </p>
        </div>
      )}
      {phase === "confirming" && (
        <p className="field-description" role="status">
          Inspecting the uploaded file. Keep this page open…
        </p>
      )}
      <button className="button secondary" disabled={!enabled || phase !== "idle"}>
        Upload this revision
      </button>
      {busy && (
        <button className="button secondary" type="button" onClick={cancel}>
          Cancel upload
        </button>
      )}
      {canRecover && phase === "blocked" && (
        <button
          className="button secondary"
          type="button"
          disabled={!enabled}
          onClick={() => void recover()}
        >
          Check uploaded file
        </button>
      )}
      {message && (
        <p ref={feedback} tabIndex={-1} id={messageId} className="field-description" role="status">
          {message}
          {needsLogin && (
            <>
              {" "}
              <Link className="text-link" href="/login">
                Sign in
              </Link>
            </>
          )}
        </p>
      )}
    </form>
  );
}
