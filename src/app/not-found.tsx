import Link from "next/link";
export default function NotFound() {
  return (
    <section className="page-content">
      <h1>This world isn’t here.</h1>
      <p className="page-intro">The page or published film you’re looking for isn’t available.</p>
      <Link className="button primary" href="/">
        Back to discovery
      </Link>
    </section>
  );
}
