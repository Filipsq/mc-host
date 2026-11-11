import { Star } from "lucide-react";
import { format } from "@/i18n/messages";
import type { HomeReviews } from "@/lib/reviews";

type Props = { items: HomeReviews["items"]; starsAria: string; replyFrom: string; label: string };

const MIN_PER_ROW = 6; // enough cards that one copy of the row is wider than a wide screen
const SECONDS_PER_CARD = 12; // slow enough to read a card with a reply

/**
 * Players' opinions as small cards sliding right to left without end. The row is
 * drawn twice so it can loop (the copy is hidden from screen readers and the
 * keyboard); few opinions are repeated so the row never runs out. It stops on
 * hover and stands still, scrolling by hand, for people who turned off animations.
 */
export default function ReviewMarquee({ items, starsAria, replyFrom, label }: Props) {
  const row = Array.from({ length: Math.ceil(MIN_PER_ROW / items.length) }, () => items).flat();
  const cards = (copy: boolean) =>
    row.map((r, i) => {
      const hidden = copy || i >= items.length; // repeats of the same opinion are read once
      return (
        <li key={`${r.id}-${copy ? "c" : ""}${i}`} className={`card review-card review-slide${copy ? " review-copy" : ""}`} aria-hidden={hidden || undefined} inert={hidden}>
          <span className="review-stars" aria-label={format(starsAria, { n: r.stars })}>
            {[1, 2, 3, 4, 5].map((n) => <Star key={n} size={14} className={n <= r.stars ? "on" : undefined} aria-hidden />)}
          </span>
          <p className="review-text">{r.text}</p>
          {r.reply && (
            <div className="review-reply">
              <strong className="small">{replyFrom}</strong>
              <p>{r.reply}</p>
            </div>
          )}
          <p className="muted small">
            <strong>{r.name}</strong>
            {r.game && ` · ${r.game}`}
          </p>
        </li>
      );
    });
  return (
    <div className="review-marquee">
      <ul className="review-track" aria-label={label} style={{ animationDuration: `${row.length * SECONDS_PER_CARD}s` }}>
        {cards(false)}
        {cards(true)}
      </ul>
    </div>
  );
}
