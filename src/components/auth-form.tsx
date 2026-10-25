"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, LoaderCircle, Mail } from "lucide-react";
import { notifyAccountChanged } from "@/lib/appearance";

const fieldGroupStyle = { display: "grid", gap: 8 } as const;

export function AuthForm({
  action,
  configured,
  initialError = "",
}: {
  action: "login" | "signup";
  configured: boolean;
  initialError?: string;
}) {
  const [stage, setStage] = useState<"choose" | "email" | "verify">("choose");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(initialError);
  const [notice, setNotice] = useState("");
  const [googleAvailable, setGoogleAvailable] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);
  const router = useRouter();
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/providers", { cache: "no-store", signal: controller.signal })
      .then(async (response) => ({ ok: response.ok, data: await response.json() }))
      .then(({ ok, data }) => setGoogleAvailable(ok && data.googleAvailable === true))
      .catch(() => {
        if (!controller.signal.aborted) setGoogleAvailable(false);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (stage === "email") emailInput.current?.focus();
    else if (stage === "verify") heading.current?.focus();
  }, [stage]);
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);
  async function request(payload: Record<string, unknown>) {
    const response = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(
        data.error ?? "Account services could not complete the request. Please try again.",
      );
    return data;
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    setNotice("");
    try {
      const data = await request(
        stage === "verify"
          ? { action: "verify_signup", email, code }
          : { action, email, password: form.get("password") },
      );
      if (data.confirmationRequired) {
        setCode("");
        setStage("verify");
        setCooldown(60);
      } else {
        notifyAccountChanged();
        router.replace(data.next === "/dashboard" ? "/dashboard" : "/onboarding");
        router.refresh();
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not connect. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function resend() {
    setBusy(true);
    setMessage("");
    setNotice("");
    try {
      await request({ action: "resend_signup", email });
      setCooldown(60);
      setNotice("A fresh code has been requested. Use the newest email.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not resend. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  const signup = action === "signup";
  return (
    <div className="auth-flow">
      {stage !== "choose" && (
        <button
          type="button"
          className="auth-back"
          disabled={busy}
          onClick={() => {
            setStage(stage === "verify" ? "email" : "choose");
            setMessage("");
            setNotice("");
          }}
        >
          <ArrowLeft size={17} aria-hidden="true" />
          {stage === "verify" ? "Change email" : "Other ways to log in"}
        </button>
      )}
      <div className="auth-flow-title" key={stage}>
        <h1 ref={heading} tabIndex={-1}>
          {stage === "verify"
            ? "Check your inbox."
            : signup
              ? "Your next world starts here."
              : "Come back to your kind of stories."}
        </h1>
        <p>
          {stage === "verify" ? (
            <>
              Enter the six-digit verification code sent to <strong>{email}</strong>.
            </>
          ) : signup ? (
            "Make a little room for the stories you love."
          ) : (
            "Log in to keep your favorites close."
          )}
        </p>
      </div>
      {!configured && (
        <p className="auth-inline-note" role="status">
          Account services are unavailable. You can keep browsing and return later.
        </p>
      )}
      {stage === "choose" ? (
        <div className="auth-provider-options">
          <button
            type="button"
            className="button primary auth-wide"
            disabled={!configured}
            onClick={() => {
              setStage("email");
              setMessage("");
            }}
          >
            <Mail size={20} aria-hidden="true" />
            {signup ? "Sign up with email" : "Log in with email"}
          </button>
          {googleAvailable ? (
            <a className="button auth-google auth-wide" href="/api/auth/google">
              <GoogleMark />
              {signup ? "Sign up with Google" : "Log in with Google"}
            </a>
          ) : (
            <button
              type="button"
              className="button auth-google auth-wide"
              disabled
              aria-describedby="google-availability"
            >
              <GoogleMark />
              {signup ? "Sign up with Google" : "Log in with Google"}
            </button>
          )}
          {!googleAvailable && (
            <p id="google-availability" className="auth-provider-note">
              {googleAvailable === null
                ? "Checking Google sign-in…"
                : "Google sign-in is not configured in this local preview. Use email to continue."}
            </p>
          )}
        </div>
      ) : (
        <form className="auth-entry-form" onSubmit={submit} aria-busy={busy}>
          {stage === "verify" ? (
            <div className="auth-field-group" style={fieldGroupStyle}>
              <label htmlFor="verification-code">Verification code</label>
              <input
                id="verification-code"
                name="code"
                className="auth-code-input"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                minLength={6}
                maxLength={6}
                required
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                disabled={busy}
                aria-describedby="code-help"
              />
              <span className="auth-field-help" id="code-help">
                Six digits. If your code expires, request a new one.
              </span>
            </div>
          ) : (
            <>
              <label htmlFor="account-email">
                Email address
                <input
                  ref={emailInput}
                  id="account-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  value={email}
                  onChange={(event) => setEmail(event.target.value.trim())}
                  disabled={!configured || busy}
                  placeholder="you@example.com"
                />
              </label>
              <div className="auth-field-group" style={fieldGroupStyle}>
                <label htmlFor="account-password">Password</label>
                <span className="auth-password-field">
                  <input
                    id="account-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete={signup ? "new-password" : "current-password"}
                    required
                    minLength={signup ? 12 : 1}
                    maxLength={128}
                    disabled={!configured || busy}
                    aria-describedby={signup ? "password-help" : undefined}
                  />
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    onClick={() => setShowPassword((value) => !value)}
                  >
                    {showPassword ? (
                      <EyeOff size={18} aria-hidden="true" />
                    ) : (
                      <Eye size={18} aria-hidden="true" />
                    )}
                  </button>
                </span>
                {signup && (
                  <span className="auth-field-help" id="password-help">
                    Use at least 12 characters. We’ll verify your email next.
                  </span>
                )}
              </div>
            </>
          )}
          {message && (
            <p className="error-message" role="alert">
              {message}
            </p>
          )}
          {notice && (
            <p className="success-message" role="status">
              <Check size={16} aria-hidden="true" /> {notice}
            </p>
          )}
          <button className="button primary auth-wide" disabled={!configured || busy}>
            {busy ? (
              <>
                <LoaderCircle size={18} className="auth-spin" aria-hidden="true" />
                {stage === "verify"
                  ? "Verifying your email…"
                  : signup
                    ? "Creating your account…"
                    : "Logging in…"}
              </>
            ) : (
              <>
                {stage === "verify" ? "Verify email" : signup ? "Create account" : "Log in"}
                <ArrowRight size={18} aria-hidden="true" />
              </>
            )}
          </button>
          {stage === "verify" && (
            <div className="auth-resend">
              <span>Didn’t receive a code?</span>
              <button
                type="button"
                className="text-button"
                disabled={busy || cooldown > 0}
                onClick={resend}
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
              </button>
            </div>
          )}
        </form>
      )}
      {stage === "choose" && message && (
        <p className="error-message" role="alert">
          {message}
        </p>
      )}
      <p className="auth-switch">
        {signup ? "Already have an account?" : "New here?"}{" "}
        <Link href={signup ? "/login" : "/signup"}>{signup ? "Log in" : "Create an account"}</Link>
      </p>
      {signup && stage !== "verify" && (
        <p className="auth-privacy-note">
          Your email is verified before you set up your private account details.
        </p>
      )}
    </div>
  );
}
function GoogleMark() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285f4"
        d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4c-.2 1.2-.9 2.2-2 2.9v2.5h3.3c1.9-1.8 2.9-4.3 2.9-7.3Z"
      />
      <path
        fill="#34a853"
        d="M12 22c2.7 0 5-.9 6.7-2.5l-3.3-2.5c-.9.6-2 .9-3.4.9-2.6 0-4.9-1.8-5.7-4.1H2.9v2.6C4.6 19.7 8.1 22 12 22Z"
      />
      <path
        fill="#fbbc05"
        d="M6.3 13.8c-.2-.6-.3-1.2-.3-1.8s.1-1.2.3-1.8V7.6H2.9A10 10 0 0 0 2 12c0 1.6.3 3.1.9 4.4l3.4-2.6Z"
      />
      <path
        fill="#ea4335"
        d="M12 6.1c1.5 0 2.8.5 3.8 1.5l2.9-2.8A9.8 9.8 0 0 0 12 2c-3.9 0-7.4 2.3-9.1 5.6l3.4 2.6C7.1 7.9 9.4 6.1 12 6.1Z"
      />
    </svg>
  );
}
