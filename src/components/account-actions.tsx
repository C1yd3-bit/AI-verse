"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, LogOut } from "lucide-react";
import { notifyAccountChanged } from "@/lib/appearance";

export function LogoutButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  async function logout() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
      if (!response.ok) throw new Error("Log out could not finish. Please try again.");
      notifyAccountChanged();
      router.replace("/");
      router.refresh();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not connect. Please try logging out again.",
      );
      setBusy(false);
    }
  }
  return (
    <div className="account-logout">
      <button type="button" className="button secondary" disabled={busy} onClick={logout}>
        {busy ? (
          <LoaderCircle size={18} className="auth-spin" aria-hidden="true" />
        ) : (
          <LogOut size={18} aria-hidden="true" />
        )}
        {busy ? "Logging out…" : "Log out"}
      </button>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
