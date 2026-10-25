import type { Metadata } from "next";
import { ModerationPanel } from "@/components/moderation-panel";
import { getSupabaseConfig } from "@/lib/env";
import "../studio/studio.css";

export const metadata: Metadata = {
  title: "Content review",
  robots: { index: false, follow: false },
};
export default function ModerationPage() {
  return (
    <section className="page-content studio-page">
      <h1>Content review</h1>
      <p className="page-intro">
        A careful review for every new world. Preview pending films and record a clear decision for
        their creators.
      </p>
      <ModerationPanel configured={Boolean(getSupabaseConfig())} />
    </section>
  );
}
