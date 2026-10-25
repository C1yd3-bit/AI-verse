export function CatalogUnavailable({ href = "/" }: { href?: string }) {
  return (
    <section className="page-content">
      <h1>The catalog is unavailable.</h1>
      <p className="page-intro" role="status">
        Published films could not be loaded. Please try again in a moment.
      </p>
      <a className="button secondary" href={href}>
        Try again
      </a>
    </section>
  );
}
