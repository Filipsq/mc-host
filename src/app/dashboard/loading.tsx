/** Shown while "Your servers" (or a server's panel, opened from it) loads. */
export default function Loading() {
  return (
    <main className="stack skeleton-page" aria-busy="true" aria-live="polite">
      <span className="skeleton skeleton-title" />
      <span className="skeleton skeleton-row" />
      <span className="skeleton skeleton-row" />
      <span className="skeleton skeleton-card short" />
    </main>
  );
}
