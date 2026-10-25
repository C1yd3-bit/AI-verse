"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, LoaderCircle, LockKeyhole } from "lucide-react";
import { accountInformationSchema, onboardingInputSchema } from "@/features/auth/onboarding";
import { genreSlugs, preferenceSchema, regionSlugs } from "@/features/preferences/schema";
import { label } from "@/features/discovery/catalog";

const steps = ["Your information", "Your interests", "Personal details"];
export function OnboardingForm({ editing = false }: { editing?: boolean }) {
  const [step, setStep] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [fullName, setFullName] = useState("");
  const [age, setAge] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [genres, setGenres] = useState<string[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [interestStatus, setInterestStatus] = useState<"completed" | "skipped">("skipped");
  const [ethnicity, setEthnicity] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const router = useRouter();
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/me/onboarding", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error ?? "Your account details could not load. Please try again.");
        if (data.profile) {
          setFullName(data.profile.fullName ?? "");
          setAge(String(data.profile.age ?? ""));
          setContactNumber(data.profile.contactNumber ?? "");
          setEthnicity(data.profile.ethnicity ?? "");
          setConsent(data.profile.ethnicityConsent === true);
        }
        const preferences = preferenceSchema.safeParse(data.preferences);
        if (preferences.success) {
          setGenres(preferences.data.genres);
          setRegions(preferences.data.regions);
          setInterestStatus(preferences.data.status);
        }
        setLoaded(true);
      } catch (error) {
        if (!controller.signal.aborted)
          setLoadError(
            error instanceof Error
              ? error.message
              : "Could not connect. Please reload to try again.",
          );
      }
    }
    void load();
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (loaded) heading.current?.focus();
  }, [step, loaded]);
  function information() {
    return {
      fullName: fullName.trim(),
      age: Number(age),
      contactNumber: contactNumber.trim() || null,
    };
  }
  function nextInformation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accountInformationSchema.safeParse(information()).success) {
      setMessage("Check your name, age (1–120), and optional contact number (7–15 digits).");
      return;
    }
    setMessage("");
    setStep(1);
  }
  function toggle(
    value: string,
    selected: string[],
    setter: (values: string[]) => void,
    limit: number,
  ) {
    setter(
      selected.includes(value)
        ? selected.filter((item) => item !== value)
        : selected.length < limit
          ? [...selected, value]
          : selected,
    );
    setMessage("");
  }
  function nextInterests(skip = false) {
    if (!skip && (genres.length < 5 || genres.length > 8)) {
      setMessage("Choose five to eight genres, or skip this step.");
      return;
    }
    setInterestStatus(skip ? "skipped" : "completed");
    setMessage("");
    setStep(2);
  }
  async function save(skipEthnicity = false) {
    const preferences =
      interestStatus === "completed"
        ? { status: "completed", genres, regions }
        : { status: "skipped", genres: [], regions: [] };
    const hasEthnicity = !skipEthnicity && Boolean(ethnicity.trim());
    const payload = {
      ...information(),
      preferences,
      ethnicity: hasEthnicity ? ethnicity.trim() : null,
      ethnicityConsent: hasEthnicity ? consent : false,
    };
    if (!onboardingInputSchema.safeParse(payload).success) {
      setMessage(
        "Check your details. Sharing ethnicity requires your consent; you can also skip it.",
      );
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/me/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error ?? "Your details were not saved. Please try again.");
      router.replace("/dashboard");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not connect. Your details are still here; please try saving again.",
      );
      setBusy(false);
    }
  }
  if (loadError)
    return (
      <div className="auth-load-state">
        <h1>Let’s try that again.</h1>
        <p className="error-message" role="alert">
          {loadError}
        </p>
        <button className="button primary" onClick={() => window.location.reload()}>
          Reload account setup
        </button>
        <Link className="text-link" href="/login">
          Go to log in
        </Link>
      </div>
    );
  if (!loaded)
    return (
      <div className="auth-load-state" role="status">
        <LoaderCircle size={30} className="auth-spin" aria-hidden="true" />
        <p>Loading your private account details…</p>
      </div>
    );
  if (busy)
    return (
      <div className="auth-saving" role="status" aria-live="polite">
        <LoaderCircle size={42} className="auth-spin" aria-hidden="true" />
        <h1>{editing ? "Saving your changes." : "Making room for you."}</h1>
        <p>
          {editing
            ? "Updating your private account details…"
            : "Saving your account and interests…"}
        </p>
        <span>You’ll arrive at your dashboard when saving is complete.</span>
      </div>
    );
  return (
    <div className="onboarding-flow">
      <ol className="onboarding-progress" aria-label="Account setup progress">
        {steps.map((name, index) => (
          <li
            key={name}
            aria-current={step === index ? "step" : undefined}
            data-completed={step > index}
          >
            <span>{step > index ? <Check size={14} aria-hidden="true" /> : index + 1}</span>
            <span>{name}</span>
          </li>
        ))}
      </ol>
      <div className="auth-flow-title" key={step}>
        <h1 ref={heading} tabIndex={-1}>
          {step === 0
            ? editing
              ? "A little update, all yours."
              : "First, a little about you."
            : step === 1
              ? "What draws you in?"
              : "Only what you want to share."}
        </h1>
        <p>
          {step === 0
            ? "Your account details stay private. Let’s start with the basics."
            : step === 1
              ? "Choose five to eight genres. We’ll keep your kind of stories in mind."
              : "Personal ethnicity is optional. Describe it in your own words, or skip this step."}
        </p>
      </div>
      {step === 0 && (
        <form className="auth-entry-form" onSubmit={nextInformation}>
          <label htmlFor="full-name">
            Full name
            <input
              id="full-name"
              name="fullName"
              autoComplete="name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              required
              maxLength={80}
              placeholder="Your full name"
            />
          </label>
          <div className="auth-information-row">
            <label htmlFor="account-age">
              Age
              <input
                id="account-age"
                name="age"
                type="number"
                inputMode="numeric"
                min={1}
                max={120}
                step={1}
                value={age}
                onChange={(event) => setAge(event.target.value)}
                required
                placeholder="Age"
              />
            </label>
            <label htmlFor="contact-number">
              Contact number <span className="auth-optional">optional</span>
              <input
                id="contact-number"
                name="contactNumber"
                type="tel"
                autoComplete="tel"
                value={contactNumber}
                onChange={(event) => setContactNumber(event.target.value)}
                maxLength={32}
                placeholder="+1 555 010 1234"
              />
            </label>
          </div>
          {message && (
            <p className="error-message" role="alert">
              {message}
            </p>
          )}
          <button className="button primary auth-wide">
            Continue <ArrowRight size={18} aria-hidden="true" />
          </button>
        </form>
      )}
      {step === 1 && (
        <div className="onboarding-interests">
          <fieldset>
            <legend className="auth-field-label">
              Genres{" "}
              <span className="auth-selection-count" aria-live="polite">
                {genres.length} of 8 selected
              </span>
            </legend>
            <div className="onboarding-chips">
              {genreSlugs.map((genre) => (
                <button
                  type="button"
                  key={genre}
                  aria-pressed={genres.includes(genre)}
                  disabled={!genres.includes(genre) && genres.length >= 8}
                  onClick={() => toggle(genre, genres, setGenres, 8)}
                >
                  {genres.includes(genre) && <Check size={14} aria-hidden="true" />}
                  {label(genre)}
                </button>
              ))}
            </div>
          </fieldset>
          <details className="onboarding-inspirations">
            <summary>
              Content inspiration <span>optional</span>
            </summary>
            <p>
              Regions that inspire the stories you enjoy. These are content preferences, separate
              from personal ethnicity.
            </p>
            <div className="onboarding-chips">
              {regionSlugs.map((region) => (
                <button
                  type="button"
                  key={region}
                  aria-pressed={regions.includes(region)}
                  onClick={() => toggle(region, regions, setRegions, 12)}
                >
                  {regions.includes(region) && <Check size={14} aria-hidden="true" />}
                  {label(region)}
                </button>
              ))}
            </div>
          </details>
          {message && (
            <p className="error-message" role="alert">
              {message}
            </p>
          )}
          <button
            type="button"
            className="button primary auth-wide"
            onClick={() => nextInterests()}
            disabled={genres.length < 5}
          >
            Continue <ArrowRight size={18} aria-hidden="true" />
          </button>
          <button type="button" className="auth-skip" onClick={() => nextInterests(true)}>
            Skip interests for now
          </button>
        </div>
      )}
      {step === 2 && (
        <form
          className="auth-entry-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label htmlFor="personal-ethnicity">
            Personal ethnicity <span className="auth-optional">optional</span>
            <input
              id="personal-ethnicity"
              name="ethnicity"
              autoComplete="off"
              value={ethnicity}
              onChange={(event) => {
                setEthnicity(event.target.value);
                if (!event.target.value.trim()) setConsent(false);
              }}
              maxLength={100}
              placeholder="Describe in your own words"
              aria-describedby="ethnicity-privacy"
            />
          </label>
          <p className="auth-private-note" id="ethnicity-privacy">
            <LockKeyhole size={17} aria-hidden="true" />
            Private to your account. Never shown publicly or used for recommendations.
          </p>
          <label className="auth-consent" htmlFor="ethnicity-consent">
            <input
              id="ethnicity-consent"
              name="ethnicityConsent"
              type="checkbox"
              checked={consent}
              disabled={!ethnicity.trim()}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              I consent to storing my self-described ethnicity in my private account details. I can
              edit or clear it later.
            </span>
          </label>
          {message && (
            <p className="error-message" role="alert">
              {message}
            </p>
          )}
          <button
            className="button primary auth-wide"
            disabled={Boolean(ethnicity.trim()) && !consent}
          >
            {editing ? "Save changes" : "Finish account setup"}
            <ArrowRight size={18} aria-hidden="true" />
          </button>
          <button type="button" className="auth-skip" onClick={() => void save(true)}>
            {editing ? "Clear ethnicity and save" : "Skip this and finish"}
          </button>
        </form>
      )}
      <div className="onboarding-bottom">
        {step > 0 ? (
          <button
            type="button"
            className="auth-back"
            onClick={() => {
              setMessage("");
              setStep((value) => value - 1);
            }}
          >
            <ArrowLeft size={17} aria-hidden="true" />
            Back
          </button>
        ) : (
          <Link href={editing ? "/dashboard" : "/"} className="auth-back">
            <ArrowLeft size={17} aria-hidden="true" />
            {editing ? "Back to account" : "Browse for now"}
          </Link>
        )}
        <span>Step {step + 1} of 3</span>
      </div>
    </div>
  );
}
