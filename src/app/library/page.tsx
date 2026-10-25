import type { Metadata } from "next";
import { LibraryPanel } from "@/components/library-panel";
import "./library.css";

export const metadata: Metadata = {
  title: "Your library",
  robots: { index: false, follow: false },
};
export default function LibraryPage() {
  return (
    <section className="page-content library-page">
      <h1>Your library</h1>
      <p className="page-intro">
        Return to your saved mixes and follow account decisions in one place.
      </p>
      <LibraryPanel />
    </section>
  );
}
