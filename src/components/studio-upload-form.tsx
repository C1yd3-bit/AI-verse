"use client";

import { useEffect, useId, useRef, useState } from "react";
import { accountChangedEvent, accountUnavailableEvent } from "@/lib/appearance";
import {
  parseUploadGrant,
  readUploadJournal,
  readUploadResponse,
  transferVideo,
  validUploadFile,
  writeUploadJournal,
} from "@/features/media/upload-client";

const recovery =
  "An upload was already attempted for this revision. Refresh status before continuing. If it remains a draft, ask an operator to reconcile the attempt or save a new revision; no retry starts automatically.";

export function StudioUploadForm({
  versionId,
  accountId,
  enabled,
  providerEnabled = true,
  onUploaded,
  onBusyChange,
}: {
  versionId: string;
  accountId: string;
  enabled: boolean;
  providerEnabled?: boolean;
  onUploaded: () => void;
  onBusyChange: (busy: boolean) => boolean | void;
}) {
  const messageId = useId();
  const progressId = useId();
  const [phase, setPhase] = useState<"checking" | "idle" | "authorizing" | "uploading" | "blocked">(
    "checking",
  );
  const [message, setMessage] = useState("");
  const [percentage, setPercentage] = useState<number | null>(null);
  const active = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const invalidated = useRef(false);
  const locked = useRef(false);
  const feedback = useRef<HTMLParagraphElement | null>(null);
  const focusFeedback = () =>
    window.requestAnimationFrame?.(() => {
      if (alive.current && !invalidated.current) feedback.current?.focus();
    });
  const current = (controller: AbortController) =>
    alive.current &&
    !invalidated.current &&
    active.current === controller &&
    !controller.signal.aborted;
  const busy = phase === "authorizing" || phase === "uploading";
  useEffect(() => {
    alive.current = true;
    void Promise.resolve().then(() => {
      if (!alive.current || invalidated.current) return;
      try {
        const earlier = readUploadJournal(sessionStorage, accountId, versionId);
        locked.current = earlier !== null;
        setPhase(earlier ? "blocked" : "idle");
        if (earlier)
          setMessage(
            earlier.phase === "sent"
              ? "File transfer was confirmed. Processing and human review are still required. Refresh status to check progress."
              : recovery,
          );
      } catch {
        locked.current = true;
        setPhase("blocked");
        setMessage(
          "Upload recovery storage is unavailable. Enable browser session storage and reload before uploading.",
        );
      }
    });
    const invalidate = () => {
      invalidated.current = true;
      active.current?.abort();
      active.current = null;
      locked.current = true;
      setPhase("blocked");
      setMessage("Your account changed. Refresh the studio before continuing.");
      onBusyChange(false);
    };
    window.addEventListener(accountChangedEvent, invalidate);
    window.addEventListener(accountUnavailableEvent, invalidate);
    return () => {
      alive.current = false;
      active.current?.abort();
      active.current = null;
      onBusyChange(false);
      window.removeEventListener(accountChangedEvent, invalidate);
      window.removeEventListener(accountUnavailableEvent, invalidate);
    };
    // Parent keys each form by verified account and immutable version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, versionId]);

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !enabled ||
      !alive.current ||
      invalidated.current ||
      active.current ||
      locked.current ||
      phase !== "idle"
    )
      return;
    const file = new FormData(event.currentTarget).get("file");
    if (!validUploadFile(file)) {
      setMessage("Choose an MP4 or MOV file no larger than 500 MB.");
      return;
    }
    if (onBusyChange(true) === false) return;
    let requestKey: string;
    try {
      if (readUploadJournal(sessionStorage, accountId, versionId)) {
        locked.current = true;
        setPhase("blocked");
        setMessage(recovery);
        onBusyChange(false);
        return;
      }
      requestKey = crypto.randomUUID();
      // Persist before any side effect: remount, navigation or an unknown grant
      // outcome can never silently mint another capability for this revision.
      writeUploadJournal(sessionStorage, accountId, versionId, { requestKey, phase: "started" });
    } catch {
      locked.current = true;
      setPhase("blocked");
      setMessage(
        "Upload recovery storage is unavailable. Enable browser session storage and reload before uploading.",
      );
      onBusyChange(false);
      return;
    }
    locked.current = true;
    const controller = new AbortController();
    active.current = controller;
    setPhase("authorizing");
    setMessage("");
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
      const response = await fetch("/api/studio/uploads", {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-AIVerse-Account": accountId },
        body: JSON.stringify({ versionId, idempotencyKey: requestKey, fileSize: file.size }),
        signal,
      });
      const raw = await readUploadResponse(response, signal);
      if (!current(controller)) return;
      if (!response.ok)
        throw new Error(
          "Upload authorization was not confirmed. Refresh status before continuing.",
        );
      const grant = parseUploadGrant(raw, accountId, versionId, Date.now(), file.size);
      setPhase("uploading");
      setPercentage(null);
      await transferVideo({
        grant,
        file,
        signal: controller.signal,
        onProgress: (value) => {
          if (current(controller)) setPercentage(value);
        },
      });
      if (!current(controller)) return;
      writeUploadJournal(sessionStorage, accountId, versionId, { requestKey, phase: "sent" });
      setPhase("blocked");
      setMessage(
        "File transfer confirmed. Processing and human review are still required. Refresh status to check progress.",
      );
      onUploaded();
      focusFeedback();
    } catch {
      try {
        writeUploadJournal(sessionStorage, accountId, versionId, {
          requestKey,
          phase: "uncertain",
        });
      } catch {
        /* The pre-request latch remains. */
      }
      if (current(controller)) {
        setPhase("blocked");
        setMessage(
          "The upload could not be confirmed. Some data may have reached the service. Refresh status before continuing; no retry was started.",
        );
        focusFeedback();
      }
    } finally {
      if (alive.current && active.current === controller) {
        active.current = null;
        onBusyChange(false);
      }
    }
  }
  function cancel() {
    if (!active.current) return;
    active.current.abort();
    active.current = null;
    onBusyChange(false);
    setPhase("blocked");
    setMessage(
      "Upload cancelled. Some data may have reached the service. Refresh status before continuing; no retry was started.",
    );
    focusFeedback();
  }
  return (
    <form className="studio-upload" onSubmit={upload} aria-busy={busy}>
      <label>
        Video file
        <input
          name="file"
          type="file"
          accept=".mp4,.mov,video/mp4,video/quicktime"
          required
          disabled={!enabled || phase !== "idle"}
          aria-describedby={message ? messageId : undefined}
        />
      </label>
      <p className="field-description">
        MP4 or MOV, up to 500 MB. Movies can run up to 20 minutes; Reels up to 3 minutes. Files over
        200 MB transfer in chunks directly to the video service after authorization.
      </p>
      {phase === "authorizing" && (
        <p className="field-description" role="status">
          Authorizing this revision…
        </p>
      )}
      {phase === "uploading" && (
        <div className="studio-upload-progress">
          <label htmlFor={progressId}>
            Uploading file{percentage === null ? "…" : ` · ${percentage}%`}
          </label>
          <progress id={progressId} max={100} value={percentage ?? undefined} />
          <p className="field-description">
            Transfer progress only. Processing and review follow after the file is received.
          </p>
        </div>
      )}
      <button className="button secondary" disabled={!enabled || phase !== "idle"}>
        Upload this revision
      </button>
      {busy && (
        <button type="button" className="button secondary" onClick={cancel}>
          Cancel upload
        </button>
      )}
      {!providerEnabled && (
        <p className="field-description">Uploads are not enabled yet. Your draft remains saved.</p>
      )}
      {message && (
        <p
          ref={feedback}
          tabIndex={-1}
          id={messageId}
          className={phase === "blocked" ? "supporting-note" : "error-message"}
          role={phase === "blocked" ? "status" : "alert"}
        >
          {message}
        </p>
      )}
    </form>
  );
}
