import "server-only";
import { randomInt } from "node:crypto";
import { Prisma, type User } from "@prisma/client";
import { messages, format } from "@/i18n/messages";
import { defaultLocale, isLocale } from "@/i18n/config";
import { db } from "./db";
import { BRAND_NAME } from "./brand";
import { buttonMail, sendMail } from "./mail";
import { sendPush } from "./push";

// Referrals: a user shares their link (/r/<code>), and when a friend who signed
// up through it first pays for at least REFERRAL_MIN_DAYS, both get
// REFERRAL_DAYS free: the friend on the server they paid for, the inviter as
// days to add to a paid server of their choice.

export const REFERRAL_DAYS = 7;
export const REFERRAL_MIN_DAYS = 30;
/** Carries the code from the invite link to sign-up. */
export const REFERRAL_COOKIE = "ref";
export const REFERRAL_COOKIE_DAYS = 30;

// No 0/o or 1/l, so a code read aloud or retyped comes out right.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE = /^[a-z0-9]{8}$/;

export const isReferralCode = (s: string) => CODE.test(s);

const randomCode = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

/** The user's invite code, made the first time they need one. */
export async function referralCode(userId: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { referralCode: true } });
    if (user.referralCode) return user.referralCode;
    try {
      // Only if still empty: two tabs opening the page at once end up with the same code.
      await db.user.updateMany({ where: { id: userId, referralCode: null }, data: { referralCode: randomCode() } });
    } catch (err) {
      // Another user already has this code; try a new one.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") || attempt > 5) throw err;
    }
  }
}

/** The user whose invite link carried this code, if any. */
export async function inviterFor(code: string | undefined) {
  if (!code || !isReferralCode(code)) return null;
  return db.user.findUnique({ where: { referralCode: code }, select: { id: true } });
}

export type Inviter = Pick<User, "id" | "email" | "locale">;

/**
 * Part of applying a payment: if the payer was invited and this is their first
 * payment of at least REFERRAL_MIN_DAYS, marks the referral rewarded and gives
 * the inviter their days. Returns the inviter (to email) when it did; the
 * caller adds REFERRAL_DAYS to the payer's server.
 */
export async function claimReferral(tx: Prisma.TransactionClient, userId: string, days: number): Promise<Inviter | null> {
  if (days < REFERRAL_MIN_DAYS) return null;
  const claimed = await tx.user.updateMany({
    where: { id: userId, referredById: { not: null }, referralRewardedAt: null },
    data: { referralRewardedAt: new Date() },
  });
  if (claimed.count === 0) return null;
  const { referredById } = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { referredById: true } });
  return tx.user.update({
    where: { id: referredById! },
    data: { bonusDays: { increment: REFERRAL_DAYS } },
    select: { id: true, email: true, locale: true },
  });
}

/** Tells the inviter their friend paid and they have free days to use. Never throws. */
export async function sendReferralMail(inviter: Inviter) {
  const locale = isLocale(inviter.locale) ? inviter.locale : defaultLocale;
  const all = messages[locale];
  const t = all.referrals.mail;
  const app = process.env.APP_URL ?? "http://localhost:3000";
  const vars = { days: REFERRAL_DAYS };
  await sendPush([inviter.id], { title: format(t.subject, vars), body: format(t.paragraphs[0], vars), url: "/dashboard/invite" });
  try {
    await sendMail(
      buttonMail({
        to: inviter.email,
        subject: format(t.subject, vars),
        paragraphs: t.paragraphs.map((p) => format(p, vars)),
        button: t.button,
        url: `${app}/dashboard/invite`,
        footer: format(all.referrals.mail.footer, { brand: BRAND_NAME, contact: `${app}/kontakt` }),
      }),
    );
  } catch (err) {
    console.error(`[mail] referral email for user ${inviter.id} failed:`, err);
  }
}
