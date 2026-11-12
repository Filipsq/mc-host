/**
 * Shown in the panel's content area the moment another tab is clicked, while
 * its page is fetched (it often asks the game machine first). The header and
 * menu stay; grey blocks in the page's rough shape turn into the real content.
 */
export default function Loading() {
  return (
    <div className="stack skeleton-page" aria-busy="true" aria-live="polite">
      <span className="skeleton skeleton-title" />
      <span className="skeleton skeleton-card" />
      <span className="skeleton skeleton-card short" />
      <span className="skeleton skeleton-card" />
    </div>
  );
}
