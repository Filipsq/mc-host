"use client";

import { useActionState, useState, useTransition } from "react";
import { Star } from "lucide-react";
import type { Messages } from "@/i18n/messages";
import { dismissReviewAction, submitReviewAction, type ReviewState } from "./reviewActions";

type Props = { t: Messages["reviews"]; textMax: number; nameMax: number };

/** The panel's one-time request for an opinion, for players who've been playing a while. */
export default function ReviewAsk({ t, textMax, nameMax }: Props) {
  const [state, action, pending] = useActionState<ReviewState, FormData>(submitReviewAction, {});
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [closing, startClosing] = useTransition();
  if (state.saved) return <p className="notice success">{t.thanks}</p>;
  const lit = hover || stars;
  return (
    <form action={action} className="card stack review-ask">
      <div className="stack-tight">
        <h2>{t.askTitle}</h2>
        <p className="muted">{t.askText}</p>
      </div>
      <fieldset className="star-pick" onMouseLeave={() => setHover(0)}>
        <legend className="small">{t.starsLabel}</legend>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className={n <= lit ? "on" : undefined} onMouseEnter={() => setHover(n)}>
            <input type="radio" name="stars" value={n} checked={stars === n} onChange={() => setStars(n)} required />
            <Star size={30} aria-hidden />
            <span className="visually-hidden">{t.starNames[n - 1]}</span>
          </label>
        ))}
      </fieldset>
      <label>
        {t.textLabel}
        <textarea name="text" rows={3} minLength={10} maxLength={textMax} required placeholder={t.textPlaceholder} />
      </label>
      <label>
        {t.nameLabel}
        <input name="name" minLength={2} maxLength={nameMax} required placeholder={t.namePlaceholder} autoComplete="nickname" />
      </label>
      <p className="muted small">{t.consent}</p>
      {state.error && <p className="error">{t.errors[state.error]}</p>}
      <div className="row">
        <button disabled={pending}>{t.submit}</button>
        <button type="button" className="secondary" disabled={closing} onClick={() => startClosing(() => dismissReviewAction())}>
          {t.later}
        </button>
      </div>
    </form>
  );
}
