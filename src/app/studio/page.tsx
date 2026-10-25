import type { Metadata } from "next";
import { StudioPanel } from "@/components/studio-panel";
import { getSupabaseConfig } from "@/lib/env";
import { getStreamConfig } from "@/features/media/stream";
import "./studio.css";

export const metadata: Metadata = {
  title: "Creator studio",
  robots: { index: false, follow: false },
};
export default function StudioPage() {
  return (
    <section className="page-content studio-page">
      <h1>Creator studio</h1>
      <p className="page-intro">
        Bring your next world to the screen. Apply to create, prepare your film, and follow each
        revision through review.
      </p>
      <StudioPanel
        configured={Boolean(getSupabaseConfig())}
        uploadsEnabled={
          Boolean(getStreamConfig()) && process.env.AIVERSE_ENABLE_STREAM_UPLOADS === "true"
        }
      />
    </section>
  );
}
