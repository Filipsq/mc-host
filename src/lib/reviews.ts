import "server-only";
import type { Edition } from "@prisma/client";
import { db } from "./db";
import { messages, format } from "@/i18n/messages";
import { defaultLocale, isLocale } from "@/i18n/config";
import { BRAND_NAME } from "./brand";
import { buttonMail, sendMail } from "./mail";
import { sendPush } from "./push";

// Players' opinions for the home page. The panel asks once a player has kept
// playing on a server for a while, so the opinion comes from real use; an admin
// decides which ones the home page shows (never edits them), and the average
// there counts all of them, so picking only the good ones can't lift it.

export const REVIEW_TEXT_MAX = 300;
export const REVIEW_NAME_MAX = 30;
export const REVIEW_REPLY_MAX = 500;
const ASK_AFTER_DAYS = 7; // the server is at least this old
const PLAYED_DAYS = 3; // and someone played on it at least this long after it was made
const HOME_MIN = 3; // fewer shown opinions than this and the home page leaves the section out
const HOME_MAX = 12; // the newest ones, sliding in a loop on the home page

const DAY = 24 * 60 * 60 * 1000;

export const EDITION_LABEL: Record<Edition, string> = {
  JAVA: "Minecraft Java",
  BEDROCK: "Minecraft Bedrock",
  TERRARIA: "Terraria",
  VALHEIM: "Valheim",
  HYTALE: "Hytale",
};

/** Whether the panel should ask this user for an opinion now. */
export async function shouldAskReview(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { reviewDismissedAt: true, review: { select: { id: true } } } });
  if (!user || user.review || user.reviewDismissedAt) return false;
  const servers = await db.server.findMany({
    where: { ownerId: userId, createdAt: { lte: new Date(Date.now() - ASK_AFTER_DAYS * DAY) } },
    select: { createdAt: true, lastPlayedAt: true },
  });
  return servers.some((s) => s.lastPlayedAt.getTime() - s.createdAt.getTime() >= PLAYED_DAYS * DAY);
}

/** The edition of the user's oldest server, shown under their name. */
export async function reviewEdition(userId: string): Promise<Edition | null> {
  const s = await db.server.findFirst({ where: { ownerId: userId }, orderBy: { createdAt: "asc" }, select: { edition: true } });
  return s?.edition ?? null;
}

export type HomeReviews = {
  average: number; // every opinion, shown or not
  count: number;
  items: { id: string; stars: number; text: string; name: string; game: string | null; reply: string | null; createdAt: Date }[];
};

/** What the home page shows, or null while there are too few shown opinions. */
export async function homeReviews(): Promise<HomeReviews | null> {
  const [all, items] = await Promise.all([
    db.review.aggregate({ _avg: { stars: true }, _count: true }),
    db.review.findMany({
      where: { shown: true },
      orderBy: { createdAt: "desc" },
      take: HOME_MAX,
      select: { id: true, stars: true, text: true, name: true, game: true, reply: true, createdAt: true },
    }),
  ]);
  if (items.length < HOME_MIN) return null;
  return {
    average: Math.round((all._avg.stars ?? 0) * 10) / 10,
    count: all._count,
    items: items.map((r) => ({ ...r, game: r.game && r.game in EDITION_LABEL ? EDITION_LABEL[r.game as Edition] : null })),
  };
}

/** The author's opinion with an admin answer they haven't seen yet, for the panel. */
export async function unseenReviewReply(userId: string) {
  const r = await db.review.findUnique({
    where: { userId },
    select: { stars: true, text: true, reply: true, repliedAt: true, replySeenAt: true },
  });
  if (!r?.reply || !r.repliedAt || (r.replySeenAt && r.replySeenAt >= r.repliedAt)) return null;
  return { stars: r.stars, text: r.text, reply: r.reply };
}

/** Tells the author by email and push that an admin answered their opinion. Never throws. */
export async function notifyReviewReply(reviewId: string) {
  const r = await db.review.findUnique({
    where: { id: reviewId },
    select: { text: true, reply: true, user: { select: { id: true, email: true, locale: true } } },
  });
  if (!r?.reply) return;
  const all = messages[isLocale(r.user.locale) ? r.user.locale : defaultLocale];
  const t = all.reviews.replyMail;
  const app = process.env.APP_URL ?? "http://localhost:3000";
  const url = `${app}/dashboard`;
  const mail = buttonMail({
    to: r.user.email,
    subject: format(t.subject, { brand: BRAND_NAME }),
    paragraphs: [t.intro, `„${r.text}”`, t.answer, ...r.reply.split("\n").map((l) => l.trim()).filter(Boolean)],
    button: t.button,
    url,
    footer: format(all.planMail.footer, { brand: BRAND_NAME, contact: `${app}/kontakt` }),
  });
  await sendPush([r.user.id], { title: mail.subject, body: r.reply.slice(0, 160), url });
  try {
    await sendMail(mail);
  } catch (err) {
    console.error(`[mail] review reply email for review ${reviewId} failed:`, err);
  }
}
