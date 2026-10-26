"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { z } from "zod";
import {
  CheckCircle2,
  ExternalLink,
  FileVideo,
  Heart,
  ListVideo,
  Moon,
  Play,
  Sun,
} from "lucide-react";
import { LogoutButton } from "@/components/account-actions";
import { ProfileAvatar } from "@/components/profile-avatar";
import { StudioPanel } from "@/components/studio-panel";
import { useAppearance } from "@/components/appearance-provider";
import { notifyAccountChanged } from "@/lib/appearance";
import {
  privateProfileSchema,
  profileInputSchema,
  type ProfileSnapshot,
} from "@/features/profile/schema";
import {
  profileSections,
  profileSectionFromHash,
  profileSectionForKey,
  type ProfileSection,
} from "@/features/profile/navigation";

const snapshotSchema = privateProfileSchema
  .extend({
    accountId: z.uuid(),
    account: privateProfileSchema.shape.account
      .unwrap()
      .extend({ email: z.string().nullable() })
      .nullable(),
    uploadsAvailable: z.boolean(),
  })
  .strict();

const stateLabels: Record<ProfileSnapshot["content"][number]["state"], string> = {
  draft: "Draft",
  uploading: "Uploading",
  processing: "Processing",
  pending_review: "Pending review",
  published: "Published",
  rejected: "Changes requested",
  failed: "Failed",
  hidden: "Hidden",
  removed: "Removed",
};

function subscribeToSection(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener("hashchange", onChange);
    window.removeEventListener("popstate", onChange);
  };
}

const currentSection = () => profileSectionFromHash(window.location.hash);
const initialSection = () => "account" as const;

export function ProfilePanel({ accountId }: { accountId: string }) {
  const router = useRouter();
  const appearance = useAppearance();
  const [snapshot, setSnapshot] = useState<ProfileSnapshot | null>(null);
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fullName, setFullName] = useState("");
  const [age, setAge] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState("");
  const [appearanceMessage, setAppearanceMessage] = useState("");
  const [studioOpen, setStudioOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const editingAccount = useRef(false);
  const selectedSection = useSyncExternalStore(subscribeToSection, currentSection, initialSection);
  const tabRefs = useRef<Partial<Record<ProfileSection, HTMLButtonElement>>>({});
  const nameInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const saveRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/me/profile", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (controller.signal.aborted) return;
        if (response.status === 401 || response.status === 403) {
          router.replace("/login");
          throw new Error("Please sign in with a verified account to continue.");
        }
        const data: unknown = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error("Your profile could not load. Please try again.");
        const profile = snapshotSchema.parse(data);
        if (profile.accountId !== accountId) {
          router.refresh();
          throw new Error("Your signed-in account changed. Refresh this page to continue.");
        }
        if (!profile.account) {
          router.replace("/onboarding");
          return;
        }
        if (controller.signal.aborted) return;
        // Content refreshes must not replace a newer account save with an older read.
        setSnapshot((value) => (value ? { ...profile, account: value.account } : profile));
        if (!editingAccount.current) {
          setFullName(profile.account.fullName);
          setAge(String(profile.account.age));
          setContactNumber(profile.account.contactNumber ?? "");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setLoadError("Your profile could not load. Please try again.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [accountId, attempt, router]);

  useEffect(() => () => saveRequest.current?.abort(), [accountId]);

  function retry() {
    setLoading(true);
    setLoadError("");
    setAttempt((value) => value + 1);
  }

  function selectSection(section: ProfileSection) {
    if (window.location.hash !== `#${section}`) {
      window.history.pushState(window.history.state, "", `#${section}`);
      window.dispatchEvent(new Event("hashchange"));
    }
  }

  function editAccount() {
    if (!snapshot?.account) return;
    setFullName(snapshot.account.fullName);
    setAge(String(snapshot.account.age));
    setContactNumber(snapshot.account.contactNumber ?? "");
    editingAccount.current = true;
    setEditing(true);
    setSaved("");
    requestAnimationFrame(() => nameInput.current?.focus());
  }

  function cancelEdit() {
    if (!snapshot?.account) return;
    setFullName(snapshot.account.fullName);
    setAge(String(snapshot.account.age));
    setContactNumber(snapshot.account.contactNumber ?? "");
    setSaveError("");
    editingAccount.current = false;
    setEditing(false);
    heading.current?.focus();
  }

  async function saveAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveError("");
    setSaved("");
    const input = profileInputSchema.safeParse({
      action: "account",
      fullName,
      age: Number(age),
      contactNumber: contactNumber.trim() || null,
    });
    if (!input.success || input.data.action !== "account") {
      setSaveError(
        "Check your name, an age from 1 to 120, and an optional phone number with 7–15 digits.",
      );
      heading.current?.focus();
      return;
    }
    const controller = new AbortController();
    saveRequest.current = controller;
    setSaving(true);
    try {
      const response = await fetch("/api/me/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AIVerse-Account": accountId },
        body: JSON.stringify(input.data),
        signal: controller.signal,
      });
      if (response.status === 409)
        throw new Error(
          "Your signed-in account changed. Refresh this page before saving. Your changes are still here.",
        );
      if (!response.ok)
        throw new Error(
          "Your details could not be saved. Your changes are still here; please try again.",
        );
      if (controller.signal.aborted) return;
      const updated = input.data;
      setSnapshot((value) =>
        value?.account
          ? {
              ...value,
              account: {
                ...value.account,
                fullName: updated.fullName,
                age: updated.age,
                contactNumber: updated.contactNumber,
              },
            }
          : value,
      );
      setFullName(updated.fullName);
      setAge(String(updated.age));
      setContactNumber(updated.contactNumber ?? "");
      setSaved("Your account details are saved.");
      editingAccount.current = false;
      setEditing(false);
      requestAnimationFrame(() => {
        if (currentSection() === "account") heading.current?.focus();
      });
      notifyAccountChanged();
    } catch (failure) {
      if (!controller.signal.aborted) {
        setSaveError(
          failure instanceof Error
            ? failure.message
            : "Your details could not be saved. Your changes are still here; please try again.",
        );
        heading.current?.focus();
      }
    } finally {
      if (!controller.signal.aborted) setSaving(false);
    }
  }

  async function chooseTheme(theme: "dark" | "light") {
    setAppearanceMessage("");
    try {
      if (await appearance.setTheme(theme))
        setAppearanceMessage(`${theme === "dark" ? "Dark" : "Light"} appearance saved.`);
    } catch {
      /* The appearance provider exposes the recoverable error below. */
    }
  }

  if (loading || !snapshot?.account)
    return (
      <section className="page-content profile-page profile-loading" aria-busy={loading}>
        <h1>Your profile</h1>
        {loading ? (
          <p role="status">Loading your private account and content…</p>
        ) : (
          <>
            <p className="error-message" role="alert">
              {loadError || "Your profile could not load."}
            </p>
            <button className="button primary" onClick={retry}>
              Try again
            </button>
          </>
        )}
        {!loading && <LogoutButton />}
      </section>
    );

  const account = snapshot.account;
  const initials = account.fullName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => Array.from(part)[0])
    .join("")
    .toLocaleUpperCase();
  const stats = snapshot.stats;
  const metrics = [
    { label: "Videos", value: stats.total, icon: Play },
    { label: "Published", value: stats.published, icon: ListVideo },
    { label: "Likes", value: stats.likes, icon: Heart },
    { label: "Recorded completions", value: stats.creditedCompletions, icon: CheckCircle2 },
  ];

  return (
    <div className="profile-page">
      <header className="profile-header">
        <div className="profile-identity">
          <ProfileAvatar accountId={accountId} initials={initials} />
          <div>
            <h1>Your profile</h1>
            <p className="profile-name">{account.fullName}</p>
          </div>
        </div>
        <LogoutButton />
      </header>
      <div className="profile-tabs" role="tablist" aria-label="Profile sections">
        {profileSections.map((section) => (
          <button
            key={section}
            id={`profile-tab-${section}`}
            type="button"
            role="tab"
            aria-selected={selectedSection === section}
            aria-controls={section}
            tabIndex={selectedSection === section ? 0 : -1}
            ref={(element) => {
              if (element) tabRefs.current[section] = element;
            }}
            onClick={() => selectSection(section)}
            onKeyDown={(event) => {
              const next = profileSectionForKey(section, event.key);
              if (!next) return;
              event.preventDefault();
              selectSection(next);
              tabRefs.current[next]?.focus();
            }}
          >
            {section.charAt(0).toUpperCase() + section.slice(1)}
          </button>
        ))}
      </div>

      <section
        id="account"
        className="profile-panel profile-account"
        role="tabpanel"
        aria-labelledby="profile-tab-account"
        hidden={selectedSection !== "account"}
        tabIndex={0}
      >
        <div className="profile-section-heading">
          <h2 id="profile-account-heading" tabIndex={-1} ref={heading}>
            Account details
          </h2>
          {!editing && (
            <button type="button" className="button secondary" onClick={editAccount}>
              Edit details
            </button>
          )}
        </div>
        {editing ? (
          <form onSubmit={saveAccount} className="profile-form" aria-busy={saving}>
            <fieldset disabled={saving}>
              <div className="profile-field">
                <label htmlFor="profile-name">Full name</label>
                <input
                  id="profile-name"
                  name="fullName"
                  autoComplete="name"
                  required
                  maxLength={80}
                  ref={nameInput}
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                />
              </div>
              <div className="profile-field">
                <label htmlFor="profile-age">Age</label>
                <input
                  id="profile-age"
                  name="age"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={120}
                  step={1}
                  required
                  value={age}
                  onChange={(event) => setAge(event.target.value)}
                />
              </div>
              <div className="profile-field">
                <label htmlFor="profile-contact">
                  Contact number <span>(optional)</span>
                </label>
                <input
                  id="profile-contact"
                  name="contactNumber"
                  type="tel"
                  autoComplete="tel"
                  maxLength={32}
                  value={contactNumber}
                  onChange={(event) => setContactNumber(event.target.value)}
                />
              </div>
              <div className="profile-field">
                <label htmlFor="profile-email">Email address</label>
                <div>
                  <input
                    id="profile-email"
                    type="email"
                    readOnly
                    value={account.email ?? ""}
                    aria-describedby="profile-email-help"
                  />
                  <p id="profile-email-help" className="profile-field-help">
                    Your email address cannot be changed here.
                  </p>
                </div>
              </div>
            </fieldset>
            {saveError && (
              <p className="error-message profile-feedback" role="alert">
                {saveError}
              </p>
            )}
            <div className="profile-form-actions">
              <button className="button primary" disabled={saving}>
                {saving ? "Saving details…" : "Save details"}
              </button>
              <button
                type="button"
                className="button secondary"
                disabled={saving}
                onClick={cancelEdit}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <dl className="profile-account-summary">
            <div>
              <dt>Full name</dt>
              <dd>{account.fullName}</dd>
            </div>
            <div>
              <dt>Email address</dt>
              <dd>{account.email || "Not available"}</dd>
            </div>
            <div>
              <dt>Age</dt>
              <dd>{account.age}</dd>
            </div>
            <div>
              <dt>Contact number</dt>
              <dd>{account.contactNumber || "Not added"}</dd>
            </div>
          </dl>
        )}
        {saved && (
          <p className="success-message profile-feedback" role="status">
            {saved}
          </p>
        )}
        <details className="profile-more-settings">
          <summary>More settings</summary>
          <div>
            <Link className="text-link" href="/settings/interests">
              Manage your interests
            </Link>
            <Link className="text-link" href="/onboarding?edit=1">
              Optional personal information
            </Link>
          </div>
        </details>
      </section>

      <section
        id="content"
        className="profile-panel profile-content"
        role="tabpanel"
        aria-labelledby="profile-tab-content"
        hidden={selectedSection !== "content"}
        tabIndex={0}
      >
        <div className="profile-section-heading">
          <h2>My content</h2>
          <button
            type="button"
            className="button primary"
            aria-expanded={studioOpen}
            aria-controls="profile-studio"
            onClick={() => setStudioOpen((value) => !value)}
          >
            <ExternalLink size={18} aria-hidden="true" />
            {studioOpen ? "Close creator studio" : "Open creator studio"}
          </button>
        </div>
        {!snapshot.uploadsAvailable && (
          <p className="profile-description profile-provider-note">
            Video uploads are unavailable. You can still prepare and manage private revisions in the
            studio.
          </p>
        )}
        {snapshot.content.length ? (
          <>
            <div className="profile-list-heading">
              <span>Latest {snapshot.content.length} videos</span>
              <button
                type="button"
                className="text-link"
                onClick={() => {
                  setLoadError("");
                  setAttempt((value) => value + 1);
                }}
              >
                Refresh content
              </button>
            </div>
            <ul className="profile-content-list">
              {snapshot.content.map((video) => (
                <li key={video.id}>
                  <FileVideo size={22} aria-hidden="true" />
                  <div className="profile-video-title">
                    <h3>{video.title || "Untitled draft"}</h3>
                    <p>
                      {video.format === "reel"
                        ? "Reel"
                        : video.format === "movie"
                          ? "Short film"
                          : "Format not selected"}{" "}
                      · {stateLabels[video.state]}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="profile-empty">
            No videos yet. Open the creator studio to see your next step.
          </p>
        )}
        {loadError && (
          <p className="error-message profile-feedback" role="alert">
            {loadError}
          </p>
        )}
        {snapshot.creator.suspended && (
          <p className="error-message profile-feedback" role="alert">
            Upload access is suspended. Existing restrictions still apply in the studio.
          </p>
        )}
        <div id="profile-studio" hidden={!studioOpen} className="profile-studio">
          {studioOpen && (
            <>
              <h2>Creator studio</h2>
              <StudioPanel configured uploadsEnabled={snapshot.uploadsAvailable} />
            </>
          )}
        </div>
      </section>

      <section
        id="statistics"
        className="profile-panel"
        role="tabpanel"
        aria-labelledby="profile-tab-statistics"
        hidden={selectedSection !== "statistics"}
        tabIndex={0}
      >
        <h2>Content statistics</h2>
        <div className="profile-statistics">
          <dl>
            {metrics.map(({ label, value, icon: Icon }) => (
              <div key={label}>
                <Icon size={21} aria-hidden="true" />
                <div>
                  <dt>{label}</dt>
                  <dd>{value.toLocaleString()}</dd>
                </div>
              </div>
            ))}
          </dl>
        </div>
        <details className="profile-statistics-help">
          <summary>About these numbers</summary>
          <p className="profile-description">
            Totals include all your retained content. Recorded completions are retained daily
            credits, not views or unique viewers. {stats.pendingReview.toLocaleString()} pending
            review · {stats.drafts.toLocaleString()} drafts.
          </p>
        </details>
        {snapshot.content.length ? (
          <>
            <div className="profile-list-heading">
              <h3>Recent video engagement</h3>
              <span>Latest {snapshot.content.length}</span>
            </div>
            <ul className="profile-content-list">
              {snapshot.content.map((video) => (
                <li key={video.id}>
                  <div className="profile-video-title">
                    <h3>{video.title || "Untitled draft"}</h3>
                  </div>
                  <dl className="profile-video-counts">
                    <div>
                      <dt>Likes</dt>
                      <dd>{video.likes.toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>Recorded completions</dt>
                      <dd>{video.creditedCompletions.toLocaleString()}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="profile-empty">
            Your video engagement will appear here when you have content.
          </p>
        )}
      </section>

      <section
        id="appearance"
        className="profile-panel profile-appearance"
        role="tabpanel"
        aria-labelledby="profile-tab-appearance"
        hidden={selectedSection !== "appearance"}
        tabIndex={0}
      >
        <h2>Appearance</h2>
        <fieldset
          className="profile-theme-options"
          disabled={!appearance.ready || appearance.saving}
          aria-describedby="profile-theme-status"
        >
          <legend className="sr-only">Saved appearance</legend>
          {(["dark", "light"] as const).map((theme) => (
            <label className="profile-theme-option" key={theme}>
              <input
                type="radio"
                name="appearance"
                value={theme}
                checked={appearance.theme === theme}
                onChange={() => void chooseTheme(theme)}
              />
              {theme === "dark" ? (
                <Moon size={20} aria-hidden="true" />
              ) : (
                <Sun size={20} aria-hidden="true" />
              )}
              <span>{theme === "dark" ? "Dark" : "Light"}</span>
            </label>
          ))}
        </fieldset>
        <p id="profile-theme-status" className="profile-theme-status" role="status">
          {appearance.saving
            ? "Saving appearance…"
            : !appearance.ready && !appearance.error
              ? "Loading your saved appearance…"
              : appearanceMessage}
        </p>
        {appearance.error && (
          <div className="profile-theme-error">
            <p className="error-message" role="alert">
              {appearance.error}
            </p>
            <button
              className="text-link"
              type="button"
              onClick={() => void appearance.refresh().catch(() => {})}
            >
              Retry appearance
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
