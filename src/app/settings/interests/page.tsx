import { PreferenceForm } from "@/components/preference-form";
export default function Interests() {
  return (
    <section className="page-content narrow-page">
      <h1>Your interests</h1>
      <p className="page-intro">Keep what you love. Leave room for a surprise.</p>
      <PreferenceForm />
    </section>
  );
}
