import { Star } from "lucide-react";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { hasProfanity, censor } from "@/lib/profanity";
import { EDITION_LABEL, REVIEW_REPLY_MAX } from "@/lib/reviews";
import { saveReviewReplyAction, setReviewShownAction } from "./actions";

export default async function AdminReviewsPage() {
  await requireAdmin();
  const [all, { locale }, reviews] = await Promise.all([
    getMessages(),
    getPreferences(),
    db.review.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { user: { select: { email: true } } } }),
  ]);
  const t = all.admin.reviews;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  return (
    <section className="card stack">
      <h2>{t.title}</h2>
      <p className="muted">{t.intro}</p>
      {reviews.length === 0 ? (
        <p className="muted">{t.empty}</p>
      ) : (
        <ul className="admin-reviews">
          {reviews.map((r) => (
            <li key={r.id} className={`admin-review${r.checkedAt ? "" : " unchecked"}`}>
              <span className="review-stars" aria-label={format(all.reviews.starsAria, { n: r.stars })}>
                {[1, 2, 3, 4, 5].map((n) => <Star key={n} size={16} className={n <= r.stars ? "on" : undefined} aria-hidden />)}
              </span>
              <p>{r.text}</p>
              {(hasProfanity(r.text) || hasProfanity(r.name)) && (
                <p className="muted small">
                  {t.censored} „{censor(r.text)}” · {censor(r.name)}
                </p>
              )}
              <p className="muted small">
                {r.name} · {r.game ? EDITION_LABEL[r.game as keyof typeof EDITION_LABEL] ?? r.game : "—"} · {r.user.email} · {date.format(r.createdAt)}
              </p>
              <div className="row">
                <span className={`badge ${r.shown ? "online" : "sleeping"}`}>{r.shown ? t.shown : r.checkedAt ? t.hidden : t.waiting}</span>
                <form action={setReviewShownAction.bind(null, r.id, !r.shown)}>
                  <button className={r.shown ? "secondary" : undefined}>{r.shown ? t.hide : t.show}</button>
                </form>
                {!r.shown && !r.checkedAt && (
                  <form action={setReviewShownAction.bind(null, r.id, false)}>
                    <button className="secondary">{t.reject}</button>
                  </form>
                )}
              </div>
              <form action={saveReviewReplyAction.bind(null, r.id)} className="stack-tight admin-review-reply">
                <label className="small">
                  {t.replyLabel}
                  <textarea name="reply" rows={2} maxLength={REVIEW_REPLY_MAX} defaultValue={r.reply ?? ""} placeholder={t.replyPlaceholder} />
                </label>
                <div className="row">
                  <button className="secondary">{r.reply ? t.replyUpdate : t.replySend}</button>
                  {r.reply && r.repliedAt && (
                    <span className="muted small">
                      {format(r.replySeenAt && r.replySeenAt >= r.repliedAt ? t.replySeen : t.replySent, { date: date.format(r.repliedAt) })}
                    </span>
                  )}
                </div>
                <p className="muted small">{t.replyHint}</p>
              </form>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
