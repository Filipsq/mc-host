import "server-only";
import type { Plan, Prisma } from "@prisma/client";
import { messages, format } from "@/i18n/messages";
import { defaultLocale, isLocale } from "@/i18n/config";
import { db } from "./db";
import { BRAND_NAME } from "./brand";
import { buttonMail, sendMail } from "./mail";
import { sendPush } from "./push";
import { planById } from "./plans";
import { REFERRAL_MIN_DAYS, isReferralCode } from "./referrals";

// Creator codes ("Polecaj i zarabiaj"): everyone's code is the one in their
// invite link (referrals.ts). A buyer who enters it pays CREATOR_DISCOUNT percent
// less for a new server's first payment. Each server bought with it that is
// paid for at least CREATOR_MIN_DAYS counts for the code's owner, once, and
// every CREATOR_GOAL of them earns a free Starter for FREE_STARTER_DAYS: a new
// server, or those days added to one they have. Free servers never count, so
// extra accounts can't farm it: ten paid servers cost far more than the reward.

export const CREATOR_DISCOUNT = 10; // percent
export const CREATOR_GOAL = 10;
export const CREATOR_MIN_DAYS = REFERRAL_MIN_DAYS;
export const FREE_STARTER_DAYS = 30;

/** "AbC D2 3x" as typed -> "abcd23x". */
export const normalizeCode = (code: string) => code.toLowerCase().replace(/\s+/g, "");

export type CreatorCheck = { creatorId: string } | { error: "creatorCodeInvalid" | "creatorCodeOwn" };

/** The owner of a code someone entered, unless it's nobody's or their own. */
export async function checkCreatorCode(code: string, buyerId: string): Promise<CreatorCheck> {
  const normalized = normalizeCode(code);
  if (!isReferralCode(normalized)) return { error: "creatorCodeInvalid" };
  const creator = await db.user.findUnique({ where: { referralCode: normalized }, select: { id: true } });
  if (!creator) return { error: "creatorCodeInvalid" };
  if (creator.id === buyerId) return { error: "creatorCodeOwn" };
  return { creatorId: creator.id };
}

/** The code the new-server form starts with: that of whoever invited the user, if anyone. */
export async function suggestedCreatorCode(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { referredBy: { select: { referralCode: true } } } });
  return user?.referredBy?.referralCode ?? "";
}

/** A price in minor units with the creator discount taken off. */
export const withCreatorDiscount = (minor: number) => Math.round((minor * (100 - CREATOR_DISCOUNT)) / 100);

/** Days of `plan` worth a free Starter: all of them on a Starter, fewer on a bigger plan. */
export function freeStarterDaysFor(plan: Plan) {
  return Math.floor((FREE_STARTER_DAYS * planById("STARTER").price.PLN) / planById(plan).price.PLN);
}

export type CreatorReward = { id: string; email: string; locale: string; count: number };

/**
 * Part of applying a payment: a server bought with a creator code counts for
 * its creator the first time it's paid for at least CREATOR_MIN_DAYS. Returns
 * the creator (to tell) when that earned them a free Starter.
 */
export async function countCreatorServer(
  tx: Prisma.TransactionClient,
  server: { id: string; creatorId: string | null; ownerId: string },
  days: number,
): Promise<CreatorReward | null> {
  if (!server.creatorId || server.creatorId === server.ownerId || days < CREATOR_MIN_DAYS) return null;
  const claimed = await tx.server.updateMany({ where: { id: server.id, creatorCountedAt: null }, data: { creatorCountedAt: new Date() } });
  if (claimed.count === 0) return null;
  const creator = await tx.user.update({
    where: { id: server.creatorId },
    data: { creatorCount: { increment: 1 } },
    select: { id: true, email: true, locale: true, creatorCount: true },
  });
  if (creator.creatorCount % CREATOR_GOAL !== 0) return null;
  await tx.user.update({ where: { id: creator.id }, data: { freeStarters: { increment: 1 } } });
  return { id: creator.id, email: creator.email, locale: creator.locale, count: creator.creatorCount };
}

/** Tells a creator they earned a free Starter. Never throws. */
export async function sendCreatorRewardMail(creator: CreatorReward) {
  const locale = isLocale(creator.locale) ? creator.locale : defaultLocale;
  const all = messages[locale];
  const t = all.creator.mail;
  const app = process.env.APP_URL ?? "http://localhost:3000";
  const vars = { count: creator.count, days: FREE_STARTER_DAYS };
  await sendPush([creator.id], { title: format(t.subject, vars), body: format(t.paragraphs[0], vars), url: "/dashboard/invite" });
  try {
    await sendMail(
      buttonMail({
        to: creator.email,
        subject: format(t.subject, vars),
        paragraphs: t.paragraphs.map((p) => format(p, vars)),
        button: t.button,
        url: `${app}/dashboard/invite`,
        footer: format(all.referrals.mail.footer, { brand: BRAND_NAME, contact: `${app}/kontakt` }),
      }),
    );
  } catch (err) {
    console.error(`[mail] creator reward email for user ${creator.id} failed:`, err);
  }
}

/** Takes one free Starter from the user; false if they have none left. */
export async function takeFreeStarter(userId: string) {
  const { count } = await db.user.updateMany({ where: { id: userId, freeStarters: { gt: 0 } }, data: { freeStarters: { decrement: 1 } } });
  return count > 0;
}

export async function giveBackFreeStarter(userId: string) {
  await db.user.update({ where: { id: userId }, data: { freeStarters: { increment: 1 } } });
}

/** "jan.kowalski@gmail.com" -> "ja***@gmail.com": enough for a creator to tell buyers apart. */
export function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 2)}***@${domain ?? ""}`;
}
