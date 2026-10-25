"use client";

import { useEffect, useId, useRef, useState } from "react";
import { accountChangedEvent, accountUnavailableEvent } from "@/lib/appearance";
import { artworkResponse, MAX_ARTWORK_INPUT_BYTES } from "@/features/media/artwork-schema";

type Props = {
  versionId: string;
  accountId: string;
  enabled: boolean;
  onBusyChange?: (busy: boolean) => boolean | void;
  onReadyChange?: (ready: boolean) => void;
  editable?: boolean;
};
export function VersionArtwork(props: Props) {
  return <RevisionArtwork key={`${props.accountId}:${props.versionId}`} {...props} />;
}
export function VersionArtworkPreview(props: Omit<Props, "editable" | "onBusyChange">) {
  return (
    <RevisionArtwork key={`${props.accountId}:${props.versionId}`} {...props} editable={false} />
  );
}
function RevisionArtwork({
  versionId,
  accountId,
  enabled,
  onBusyChange,
  onReadyChange,
  editable = true,
}: Props) {
  const inputId = useId();
  const messageId = useId();
  const callback = useRef(onBusyChange);
  const readyCallback = useRef(onReadyChange);
  const active = useRef<AbortController | null>(null);
  const load = useRef<AbortController | null>(null);
  const alive = useRef(false);
  const invalidated = useRef(false);
  const imageRevision = useRef(0);
  const [image, setImage] = useState<string | null>(null);
  const [imageKey, setImageKey] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [retryVisible, setRetryVisible] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    callback.current = onBusyChange;
    readyCallback.current = onReadyChange;
  }, [onBusyChange, onReadyChange]);
  const path = `/api/studio/versions/${versionId}/artwork`;
  const current = (controller: AbortController) =>
    alive.current && !invalidated.current && !controller.signal.aborted;
  function parse(value: unknown) {
    const result = artworkResponse.parse(value);
    if (result.accountId !== accountId || result.versionId !== versionId)
      throw new Error("Account or film revision changed.");
    return result.image;
  }
  async function loadThumbnail() {
    if (!alive.current || invalidated.current || active.current) return;
    load.current?.abort();
    const controller = new AbortController();
    load.current = controller;
    setLoading(true);
    imageRevision.current += 1;
    readyCallback.current?.(false);
    const deadline = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(path, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { "X-AIVerse-Account": accountId },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("Thumbnail unavailable");
      const photo = parse(await response.json());
      if (current(controller) && load.current === controller) {
        setImage(photo);
        setImageKey(imageRevision.current);
        setError(false);
        setMessage(photo ? "Saved thumbnail loaded." : "No thumbnail saved for this revision.");
        // An image response is not proof the browser decoded it. Confirm a
        // missing optional image immediately; non-null waits for native load.
        readyCallback.current?.(photo === null);
      }
    } catch {
      if (alive.current && !invalidated.current && load.current === controller) {
        setError(true);
        setRetryVisible(true);
        setMessage("Thumbnail could not load. Choose Reload thumbnail to try again.");
        readyCallback.current?.(false);
      }
    } finally {
      clearTimeout(deadline);
      if (alive.current && load.current === controller) {
        load.current = null;
        setLoading(false);
      }
    }
  }
  useEffect(() => {
    alive.current = true;
    queueMicrotask(() => void loadThumbnail());
    const invalidate = () => {
      invalidated.current = true;
      setBlocked(true);
      load.current?.abort();
      load.current = null;
      active.current?.abort();
      active.current = null;
      setImage(null);
      setFile(null);
      setBusy(false);
      setLoading(false);
      setError(true);
      setMessage("Your account changed. Refresh the studio before continuing.");
      callback.current?.(false);
      readyCallback.current?.(false);
    };
    window.addEventListener(accountChangedEvent, invalidate);
    window.addEventListener(accountUnavailableEvent, invalidate);
    return () => {
      alive.current = false;
      load.current?.abort();
      load.current = null;
      active.current?.abort();
      active.current = null;
      callback.current?.(false);
      readyCallback.current?.(false);
      window.removeEventListener(accountChangedEvent, invalidate);
      window.removeEventListener(accountUnavailableEvent, invalidate);
    };
    // Each identity/version pair remounts. Callback identity must not restart private reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, versionId]);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editable || !enabled || !file || active.current || !alive.current || invalidated.current)
      return;
    if (callback.current?.(true) === false) return;
    load.current?.abort();
    load.current = null;
    setLoading(false);
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(false);
    setMessage("Saving thumbnail…");
    const deadline = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(path, {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: { "Content-Type": file.type, "X-AIVerse-Account": accountId },
        body: file,
        signal: controller.signal,
      });
      if (!response.ok)
        throw new Error(
          response.status === 400 || response.status === 415 || response.status === 413
            ? "Choose a valid still JPEG, PNG or WebP no larger than 5 MB and 16 megapixels."
            : response.status === 403 || response.status === 409 || response.status === 401
              ? "Your access or draft changed. Refresh status before continuing."
              : "Thumbnail save was not confirmed. Refresh status before trying again.",
        );
      const photo = parse(await response.json());
      if (!photo)
        throw new Error("Thumbnail save was not confirmed. Refresh status before trying again.");
      if (current(controller) && active.current === controller) {
        setImage(photo);
        imageRevision.current += 1;
        setImageKey(imageRevision.current);
        setFile(null);
        setMessage(
          "Thumbnail saved for this revision. Human review is required before it becomes public.",
        );
      }
    } catch (failure) {
      if (alive.current && !invalidated.current && active.current === controller) {
        setError(true);
        setRetryVisible(true);
        setMessage(
          controller.signal.aborted
            ? "Thumbnail save was not confirmed. Refresh status before trying again."
            : failure instanceof Error
              ? failure.message
              : "Thumbnail could not save. Refresh status to try again.",
        );
      }
    } finally {
      clearTimeout(deadline);
      if (active.current === controller) {
        active.current = null;
        callback.current?.(false);
        if (alive.current) setBusy(false);
      }
    }
  }
  const preview = image && (
    // Native data image avoids a public image-optimizer cache for private artwork.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={imageKey}
      src={image}
      alt="Saved thumbnail for this film revision"
      width={240}
      height={135}
      style={{ maxWidth: "100%", height: "auto", maxHeight: 240, objectFit: "contain" }}
      onLoad={() => {
        if (alive.current && !invalidated.current && imageRevision.current === imageKey)
          readyCallback.current?.(true);
      }}
      onError={() => {
        if (!alive.current || invalidated.current || imageRevision.current !== imageKey) return;
        imageRevision.current += 1;
        setImage(null);
        setError(true);
        setRetryVisible(true);
        setMessage("Thumbnail could not display. Choose Reload thumbnail to try again.");
        readyCallback.current?.(false);
      }}
    />
  );
  const feedback = (
    <>
      {loading && (
        <p className="field-description" role="status">
          Loading thumbnail…
        </p>
      )}
      {retryVisible && !busy && (
        <button
          className="button secondary"
          type="button"
          onClick={() => void loadThumbnail()}
          disabled={!enabled || loading || blocked}
        >
          {loading ? "Loading thumbnail…" : "Reload thumbnail"}
        </button>
      )}
      <p
        id={messageId}
        className={error ? "form-error" : "supporting-note"}
        role={error ? "alert" : "status"}
      >
        {message}
      </p>
    </>
  );
  if (!editable)
    return (
      <div className="studio-upload" aria-busy={loading} aria-labelledby={`${inputId}-heading`}>
        <p id={`${inputId}-heading`}>Thumbnail for this revision</p>
        {preview}
        {feedback}
      </div>
    );
  return (
    <form className="studio-upload" onSubmit={save} aria-busy={busy}>
      <label htmlFor={inputId}>Thumbnail (optional)</label>
      <p className="field-description" id={`${inputId}-hint`}>
        Choose a still JPEG, PNG or WebP up to 5 MB. Save it before uploading the video. Your image
        keeps its proportions.
      </p>
      {preview}
      <input
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={!enabled || busy || blocked}
        aria-describedby={`${inputId}-hint ${messageId}`}
        onChange={(event) => {
          const chosen = event.currentTarget.files?.[0];
          setFile(null);
          setError(false);
          setMessage("");
          if (!chosen || !enabled || active.current || invalidated.current) return;
          if (
            !["image/jpeg", "image/png", "image/webp"].includes(chosen.type) ||
            !chosen.size ||
            chosen.size > MAX_ARTWORK_INPUT_BYTES
          ) {
            setError(true);
            setMessage("Choose a still JPEG, PNG or WebP no larger than 5 MB.");
            event.currentTarget.value = "";
            return;
          }
          setFile(chosen);
        }}
      />
      <button
        className="button secondary"
        type="submit"
        disabled={!enabled || busy || !file || blocked}
      >
        {busy ? "Saving thumbnail…" : "Save thumbnail"}
      </button>
      {feedback}
    </form>
  );
}
