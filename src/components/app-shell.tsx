"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { House, Clapperboard, Film, Sparkles, UserRound, Search } from "lucide-react";
import { accountChangedEvent } from "@/lib/appearance";
import { DiscoveryAssistant } from "./discovery-assistant";

const navigation = [
  { href: "/", label: "Home", icon: House },
  { href: "/reels", label: "Reels", icon: Clapperboard },
  { href: "/movies", label: "Movies", icon: Film },
  { href: "/fusion", label: "Fusion", icon: Sparkles },
];
export function AppShell({ children }: { children: React.ReactNode; liveCatalog?: boolean }) {
  const path = usePathname();
  const standalone = path === "/login" || path === "/signup" || path === "/onboarding";
  const reelViewer = path.startsWith("/reels/");
  const [account, setAccount] = useState<{ name: string; href: string } | null>(null);
  const [accountRevision, setAccountRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setAccountRevision((value) => value + 1);
    window.addEventListener(accountChangedEvent, refresh);
    return () => window.removeEventListener(accountChangedEvent, refresh);
  }, []);
  useEffect(() => {
    if (standalone) return;
    const controller = new AbortController();
    fetch("/api/me/onboarding", { cache: "no-store", signal: controller.signal })
      .then(async (response) => ({ status: response.status, data: await response.json() }))
      .then(({ status, data }) => {
        if (controller.signal.aborted) return;
        if (status === 200)
          setAccount({
            name: data.profile?.fullName || "Your account",
            href: data.next === "/dashboard" ? "/profile" : "/onboarding",
          });
        else if (status === 401 || status === 403) setAccount(null);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [path, standalone, accountRevision]);
  if (standalone)
    return (
      <>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <main id="main">{children}</main>
      </>
    );
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link href="/" className="wordmark" aria-label="AIVerse home">
          <span>AI</span>VERSE
        </Link>
        <nav aria-label="Main navigation">
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link
              href={href}
              key={href}
              aria-current={path === href || (href === "/reels" && reelViewer) ? "page" : undefined}
            >
              <Icon size={22} aria-hidden="true" />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <Link
          href={account?.href ?? "/login"}
          className="interests-link"
          title={account?.name}
          aria-current={path === account?.href ? "page" : undefined}
        >
          <UserRound size={22} aria-hidden="true" />
          <span className="rail-account-name">{account?.name ?? "Log in"}</span>
        </Link>
      </aside>
      <div className={`workspace${reelViewer ? " workspace-reel-viewer" : ""}`}>
        {!reelViewer && (
          <header className="topbar">
            <form action="/search" className="search-box" role="search">
              <Search size={22} aria-hidden="true" />
              <input
                name="q"
                aria-label="Search published films"
                placeholder="What do you feel like watching?"
              />
              <button type="submit" className="search-submit" aria-label="Search">
                <Search size={18} aria-hidden="true" />
              </button>
            </form>
            <DiscoveryAssistant />
            <p className="demo-notice">AI-created &#183; Reviewed before publication</p>
          </header>
        )}
        <main id="main">{children}</main>
        {path !== "/profile" && !reelViewer && (
          <footer className="site-footer">
            <span>A world of imagination. A catalog you can trust.</span>
            <Link href={account?.href ?? "/login"}>{account ? "Your account" : "Log in"}</Link>
            <Link href="/library">Your library</Link>
            <Link href="/studio">Creator studio</Link>
            <Link href="/moderation">Review queue</Link>
            <Link href="/operations">Operations</Link>
          </footer>
        )}
      </div>
    </>
  );
}
