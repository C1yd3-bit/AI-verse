"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { type DiscoveryQuery, discoveryQuerySchema } from "@/features/discovery/query";
import { accountRequest, AccountRequestError } from "./viewer-actions";
import "@/app/library/library.css";

export function SavedFusion({
  query,
  expectedAccountId,
}: {
  query: DiscoveryQuery;
  expectedAccountId?: string;
}) {
  const nameId = useId();
  const [busy, setBusy] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const activeRequest = useRef<AbortController | null>(null);
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current += 1;
      activeRequest.current?.abort();
    },
    [expectedAccountId],
  );
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (activeRequest.current) return;
    const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
    const parsed = discoveryQuerySchema.safeParse(query);
    if (!name || name.length > 80 || !parsed.success) {
      setError("Give this mix a name of up to 80 characters and check its filters.");
      return;
    }
    setBusy(true);
    setMessage("");
    setError("");
    const controller = new AbortController();
    activeRequest.current = controller;
    const currentGeneration = ++generation.current;
    try {
      const body = {
        action: "save_fusion",
        id: null,
        name,
        query: parsed.data,
      };
      if (expectedAccountId) {
        const response = await fetch("/api/me/library", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json", "X-AIVerse-Account": expectedAccountId },
          body: JSON.stringify(body),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        });
        if (!response.ok)
          throw new AccountRequestError(
            response.status,
            response.status === 401
              ? "Sign in to save this mix."
              : response.status === 409
                ? "Your account changed. Open the current search again before saving."
                : "The mix could not be saved. Check your library and try again.",
          );
      } else {
        await accountRequest("/api/me/library", body, controller.signal);
      }
      if (controller.signal.aborted || currentGeneration !== generation.current) return;
      setSignedOut(false);
      setMessage("Mix saved to your account library.");
    } catch (error) {
      if (controller.signal.aborted || currentGeneration !== generation.current) return;
      setSignedOut(error instanceof AccountRequestError && error.status === 401);
      setError(
        error instanceof AccountRequestError
          ? error.message
          : "The mix could not be saved. Try again.",
      );
    } finally {
      if (currentGeneration === generation.current) {
        activeRequest.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <details className="account-disclosure saved-fusion">
      <summary>Save this mix</summary>
      <p className="field-description">
        Keep these filters in your account to use again. Each account can save up to twenty mixes.
      </p>
      <form className="library-form" onSubmit={save}>
        <label htmlFor={nameId}>
          Mix name
          <input
            id={nameId}
            name="name"
            required
            maxLength={80}
            disabled={busy}
            autoComplete="off"
          />
        </label>
        <button className="button secondary" disabled={busy}>
          {busy ? "Saving…" : "Save mix to account"}
        </button>
      </form>
      {error && (
        <p className="error-message" role="alert">
          {error}{" "}
          {signedOut && (
            <Link className="text-link" href="/login">
              Sign in to save this mix
            </Link>
          )}
          {!signedOut && (
            <Link className="text-link" href="/library">
              Check your saved mixes before trying again
            </Link>
          )}
        </p>
      )}
      {message && (
        <p className="success-message" role="status">
          {message}{" "}
          <Link className="text-link" href="/library">
            Open your library
          </Link>
        </p>
      )}
    </details>
  );
}
