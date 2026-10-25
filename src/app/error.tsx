"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="page-content">
      <h1>Something interrupted the story.</h1>
      <p className="page-intro">We couldn’t load this page. Try again in a moment.</p>
      <button className="button primary" onClick={reset}>
        Try again
      </button>
    </section>
  );
}
