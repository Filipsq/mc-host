import { MessageSquareReply, Star } from "lucide-react";
import type { Messages } from "@/i18n/messages";
import { format } from "@/i18n/messages";
import { BRAND_NAME } from "@/lib/brand";
import { seenReviewReplyAction } from "./reviewActions";

type Props = { t: Messages["reviews"]; review: { stars: number; text: string; reply: string } };

/** The admin's answer to the user's opinion, shown in the panel until they mark it read. */
export default function ReviewReply({ t, review }: Props) {
  return (
    <section className="card stack review-reply-card">
      <h2 className="row"><MessageSquareReply size={22} aria-hidden /> {t.replyTitle}</h2>
      <div className="stack-tight">
        <span className="muted small">{t.replyYours}</span>
        <span className="review-stars" aria-label={format(t.starsAria, { n: review.stars })}>
          {[1, 2, 3, 4, 5].map((n) => <Star key={n} size={16} className={n <= review.stars ? "on" : undefined} aria-hidden />)}
        </span>
        <p className="muted">{review.text}</p>
      </div>
      <div className="review-reply">
        <strong className="small">{format(t.replyFrom, { brand: BRAND_NAME })}</strong>
        <p>{review.reply}</p>
      </div>
      <form action={seenReviewReplyAction}>
        <button className="secondary">{t.replyOk}</button>
      </form>
    </section>
  );
}
