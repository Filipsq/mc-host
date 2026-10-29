import "server-only";
import { db } from "./db";
import { messages, format } from "@/i18n/messages";
import { defaultLocale, isLocale } from "@/i18n/config";
import { BRAND_NAME } from "./brand";
import { buttonMail, sendMail } from "./mail";
import { sendPush } from "./push";
import { unsubscribeUrl } from "./comeback";

// "Start offer": someone who keeps playing on a free server, and has never paid,
// gets START_OFFER_DISCOUNT percent off their first payment for START_OFFER_DAYS.
// It starts (User.startOfferAt) the first time players are seen on a free server
// at least START_OFFER_AFTER_DAYS old, with an email and a phone notification;
// the panel shows it on their free servers and the billing page until it ends.
// Not combined with a creator or promo code: whichever is given wins.

export const START_OFFER_DISCOUNT = 10; // percent
export const START_OFFER_DAYS = 7;
export const START_OFFER_AFTER_DAYS = 3;

const DAY = 24 * 60 * 60 * 1000;

/** When the user's start offer ends, if they have one running now and have never paid. */
export async function startOfferEnds(userId: string, now = new Date()): Promise<Date | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { startOfferAt: true } });
  if (!user?.startOfferAt) return null;
  const ends = new Date(user.startOfferAt.getTime() + START_OFFER_DAYS * DAY);
  if (ends <= now) return null;
  return (await hasPaid(userId)) ? null : ends;
}

const hasPaid = async (userId: string) => (await db.payment.count({ where: { userId, status: "PAID", amount: { gt: 0 } } })) > 0;

/** A price in minor units with the start offer taken off. */
export const withStartOfferDiscount = (minor: number) => Math.round((minor * (100 - START_OFFER_DISCOUNT)) / 100);

/**
 * Starts the offer for owners of the free servers in `playing` (players on
 * them right now) that are old enough. Called by the billing job; returns how
 * many offers it started.
 */
export async function startOffers(now: Date, playing: string[]): Promise<number> {
  if (playing.length === 0) return 0;
  const servers = await db.server.findMany({
    where: {
      id: { in: playing },
      plan: "FREE",
      adminTest: false,
      createdAt: { lte: new Date(now.getTime() - START_OFFER_AFTER_DAYS * DAY) },
      owner: { startOfferAt: null, admin: false },
    },
    include: { owner: { select: { email: true, locale: true, comebackOff: true } } },
  });
  const byOwner = new Map<string, (typeof servers)[number]>();
  for (const s of servers) if (!byOwner.has(s.ownerId)) byOwner.set(s.ownerId, s);
  let started = 0;
  for (const [ownerId, server] of byOwner) {
    if (await hasPaid(ownerId)) continue;
    // Claim first, so overlapping runs don't both send.
    const claim = await db.user.updateMany({ where: { id: ownerId, startOfferAt: null }, data: { startOfferAt: now } });
    if (claim.count === 0) continue;
    started++;
    // Turned reminder emails off: the offer still shows in the panel.
    if (server.owner.comebackOff) continue;
    const locale = isLocale(server.owner.locale) ? server.owner.locale : defaultLocale;
    const t = messages[locale].startOffer;
    const vars = {
      server: server.name,
      n: START_OFFER_DISCOUNT,
      date: new Date(now.getTime() + START_OFFER_DAYS * DAY).toLocaleDateString(locale, { dateStyle: "long", timeZone: "Europe/Warsaw" }),
    };
    const app = process.env.APP_URL ?? "http://localhost:3000";
    const page = `${app}/dashboard/servers/${server.id}/billing`;
    const mail = buttonMail({
      to: server.owner.email,
      subject: format(t.mailSubject, vars),
      paragraphs: t.mailParagraphs.map((p) => format(p, vars)),
      button: t.button,
      url: page,
      footer: format(t.mailFooter, { brand: BRAND_NAME }),
      unsubscribe: { label: messages[locale].comebackMail.unsubscribe, url: unsubscribeUrl(ownerId) },
    });
    try {
      await sendMail(mail);
      await sendPush([ownerId], { title: mail.subject, body: format(t.push, vars), url: page });
    } catch (err) {
      // The offer stays on in the panel even if the email didn't go.
      console.error(`[mail] start offer email for user ${ownerId} failed:`, err);
    }
  }
  return started;
}
