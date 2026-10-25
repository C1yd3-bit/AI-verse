import type { Metadata } from "next";
import { OperationsPanel } from "@/components/operations-panel";
import "../library/library.css";

export const metadata: Metadata = { title: "Operations", robots: { index: false, follow: false } };
export default function OperationsPage() {
  return (
    <section className="page-content operations-page">
      <h1>Operations</h1>
      <p className="page-intro">
        Review reports, decide creator appeals and manage access with an audit trail.
      </p>
      <OperationsPanel />
    </section>
  );
}
