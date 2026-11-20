"use client";

import Link from "next/link";

// Shown when a page fails on the server instead of the browser's bare error.
// It never shows the error itself (that stays in `docker compose logs web`),
// only its digest, which matches the line in the logs.
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="wide-form stack">
      <h1>Coś poszło nie tak</h1>
      <p className="muted">Spróbuj jeszcze raz za chwilę. Jeśli to się powtarza, napisz do nas na czacie pomocy.</p>
      <p className="muted small">Something went wrong. Please try again in a moment.</p>
      <div className="row">
        <button className="button" type="button" onClick={reset}>Spróbuj ponownie</button>
        <Link className="button secondary" href="/">Strona główna</Link>
      </div>
      {error.digest && <p className="muted small">Kod: {error.digest}</p>}
    </main>
  );
}
