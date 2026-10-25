"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, Pencil } from "lucide-react";

const maxPhotoBytes = 5 * 1024 * 1024;
const photoTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function photoFromResponse(value: unknown, accountId: string): string | null {
  if (!value || typeof value !== "object") throw new Error("Invalid photo response.");
  const data = value as Record<string, unknown>;
  if (data.accountId !== accountId) throw new Error("Account changed.");
  if (data.image === null) return null;
  if (
    typeof data.image !== "string" ||
    data.image.length > 750_000 ||
    !/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(data.image)
  ) {
    throw new Error("Invalid photo response.");
  }
  return data.image;
}

export function ProfileAvatar({ accountId, initials }: { accountId: string; initials: string }) {
  // Remount at the identity boundary so a previous account's photo never renders.
  return <AccountAvatar key={accountId} accountId={accountId} initials={initials} />;
}

function AccountAvatar({ accountId, initials }: { accountId: string; initials: string }) {
  const input = useRef<HTMLInputElement>(null);
  const loadRequest = useRef<AbortController | null>(null);
  const uploadRequest = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const statusId = useId();
  const [image, setImage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const requestGeneration = ++generation.current;
    loadRequest.current = controller;
    fetch("/api/me/avatar", {
      cache: "no-store",
      headers: { "X-AIVerse-Account": accountId },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Photo could not load.");
        const photo = photoFromResponse(await response.json(), accountId);
        if (!controller.signal.aborted && generation.current === requestGeneration) {
          setImage(photo);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && generation.current === requestGeneration) {
          setHasError(true);
          setMessage("Photo could not load. Select a photo to try again.");
        }
      });
    return () => {
      controller.abort();
      uploadRequest.current?.abort();
    };
  }, [accountId]);

  async function selectPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || saving) return;
    setHasError(false);
    if (!photoTypes.has(file.type)) {
      setHasError(true);
      setMessage("Choose a JPEG, PNG or WebP image.");
      return;
    }
    if (!file.size || file.size > maxPhotoBytes) {
      setHasError(true);
      setMessage("Choose a photo smaller than 5 MB.");
      return;
    }

    loadRequest.current?.abort();
    const requestGeneration = ++generation.current;
    const controller = new AbortController();
    uploadRequest.current = controller;
    setSaving(true);
    setMessage("Saving photo…");
    try {
      const response = await fetch("/api/me/avatar", {
        method: "POST",
        headers: { "Content-Type": file.type, "X-AIVerse-Account": accountId },
        body: file,
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403 || response.status === 409) {
        throw new Error("Your account changed. Refresh before choosing a photo.");
      }
      if (response.status === 413) throw new Error("Choose a photo smaller than 5 MB.");
      if (response.status === 400 || response.status === 415) {
        throw new Error("This image could not be read. Choose another JPEG, PNG or WebP.");
      }
      if (!response.ok) throw new Error("Photo could not save. Select it again to retry.");
      const photo = photoFromResponse(await response.json(), accountId);
      if (!photo) throw new Error("Photo could not save. Select it again to retry.");
      if (!controller.signal.aborted && generation.current === requestGeneration) {
        setImage(photo);
        setMessage("Profile photo saved.");
      }
    } catch (failure) {
      if (!controller.signal.aborted && generation.current === requestGeneration) {
        setHasError(true);
        setMessage(
          failure instanceof Error
            ? failure.message
            : "Photo could not save. Select it again to retry.",
        );
      }
    } finally {
      if (!controller.signal.aborted && generation.current === requestGeneration) {
        setSaving(false);
      }
    }
  }

  return (
    <div className="profile-avatar-control">
      <button
        type="button"
        className="profile-avatar"
        aria-label="Change profile photo"
        aria-describedby={message ? statusId : undefined}
        aria-busy={saving}
        disabled={saving}
        title="Change profile photo"
        onClick={() => input.current?.click()}
      >
        {image ? (
          // Private normalized data URLs need no remote loader or public image endpoint.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image}
            alt=""
            className="profile-avatar-image"
            onError={() => {
              setImage(null);
              setHasError(true);
              setMessage("Photo could not display. Choose another image.");
            }}
          />
        ) : (
          <span aria-hidden="true">{initials}</span>
        )}
        <span className={`profile-avatar-edit${saving ? " is-saving" : ""}`} aria-hidden="true">
          {saving ? <LoaderCircle size={14} /> : <Pencil size={14} />}
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="Select profile photo"
        hidden
        disabled={saving}
        onChange={(event) => void selectPhoto(event)}
      />
      <p
        id={statusId}
        className={`profile-avatar-feedback${hasError ? " error-message" : ""}`}
        role="status"
        aria-live="polite"
      >
        {message}
      </p>
    </div>
  );
}
