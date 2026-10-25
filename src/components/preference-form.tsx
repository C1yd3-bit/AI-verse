"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, ChevronRight, ArrowLeft } from "lucide-react";
import { genreSlugs, regionSlugs, preferenceSchema } from "@/features/preferences/schema";
import { label } from "@/features/discovery/catalog";
export function PreferenceForm({ onboarding = false }: { onboarding?: boolean }) {
  const [genres, setGenres] = useState<string[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [step, setStep] = useState(onboarding ? 1 : 2);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch("/api/me/preferences", { cache: "no-store" });
        const result = await response.json();
        if (!active) return;
        if (!response.ok) {
          setMessage(result.error ?? "Could not load your interests.");
          return;
        }
        const parsed = preferenceSchema.safeParse(result.preferences);
        if (parsed.success) {
          setGenres(parsed.data.genres);
          setRegions(parsed.data.regions);
        }
      } catch {
        if (active) setMessage("Could not reach account services. Try again later.");
      } finally {
        if (active) setLoaded(true);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);
  function toggle(value: string, values: string[], setter: (value: string[]) => void, max: number) {
    if (values.includes(value)) setter(values.filter((item) => item !== value));
    else if (values.length < max) setter([...values, value]);
    setSaved(false);
    setMessage("");
  }
  async function save(skip = false) {
    const result = preferenceSchema.safeParse(
      skip
        ? { status: "skipped", genres: [], regions: [] }
        : { status: "completed", genres, regions },
    );
    if (!result.success) {
      setMessage("Choose 5–8 genres to save, or skip for now.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/me/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.data),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save interests.");
      if (skip) {
        setGenres([]);
        setRegions([]);
      }
      setSaved(true);
      setMessage(
        skip
          ? "Onboarding skipped. You can choose your interests any time."
          : "Your account interests are saved.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Storage is unavailable. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  const genreSection = (
    <fieldset>
      <legend>Choose the stories you love</legend>
      <p className="field-description">
        Select 5–8 genres. A little variety helps you find something unexpected.
      </p>
      <div className="choice-grid">
        {genreSlugs.map((genre) => (
          <button
            type="button"
            key={genre}
            aria-pressed={genres.includes(genre)}
            disabled={busy || (!genres.includes(genre) && genres.length >= 8)}
            onClick={() => toggle(genre, genres, setGenres, 8)}
          >
            {label(genre)}
            {genres.includes(genre) && <Check size={17} aria-hidden="true" />}
          </button>
        ))}
      </div>
      <p className="selection-count" aria-live="polite">
        {genres.length} of 5–8 genres selected
      </p>
    </fieldset>
  );
  return (
    <div className="preferences-content">
      <p className="demo-callout">Account preferences · Sign in to save across devices.</p>
      {!loaded ? (
        <p role="status">Loading your interests…</p>
      ) : (
        <>
          {(!onboarding || step === 1) && genreSection}
          {onboarding && step === 2 && (
            <button type="button" className="text-button" onClick={() => setStep(1)}>
              <ArrowLeft size={16} aria-hidden="true" />
              Back to genres
            </button>
          )}
          {(!onboarding || step === 2) && (
            <fieldset>
              <legend>Where should your imagination go?</legend>
              <p className="field-description">
                Optional cultural and regional content inspiration. These describe content
                preferences, never your personal ethnicity.
              </p>
              <div className="choice-grid">
                {regionSlugs.map((region) => (
                  <button
                    type="button"
                    key={region}
                    aria-pressed={regions.includes(region)}
                    disabled={busy}
                    onClick={() => toggle(region, regions, setRegions, 12)}
                  >
                    {region === "global" ? "Global / any" : label(region)}
                    {regions.includes(region) && <Check size={17} aria-hidden="true" />}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <div className="form-actions">
            {onboarding && step === 1 ? (
              <button
                className="button primary"
                type="button"
                disabled={genres.length < 5 || busy}
                onClick={() => setStep(2)}
              >
                Continue
                <ChevronRight size={17} aria-hidden="true" />
              </button>
            ) : (
              <button
                className="button primary"
                type="button"
                disabled={busy || genres.length < 5}
                onClick={() => void save()}
              >
                {busy ? "Saving…" : "Save account interests"}
              </button>
            )}
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={() => void save(true)}
            >
              Skip for now
            </button>
            <Link className="text-link" href="/login">
              Sign in
            </Link>
          </div>
        </>
      )}
      {message && (
        <p
          className={saved ? "success-message" : "error-message"}
          role={saved ? "status" : "alert"}
        >
          {message}
        </p>
      )}
      {saved && (
        <Link className="button secondary" href="/">
          Back to discovery
          <ChevronRight size={17} aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
