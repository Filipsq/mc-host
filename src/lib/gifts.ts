import "server-only";
import { randomInt } from "crypto";
import type { GiftCode, Plan, Server, User } from "@prisma/client";
import { messages, format } from "@/i18n/messages";
import { defaultLocale, isLocale, type Currency, type Locale } from "@/i18n/config";
import { db } from "./db";
import { stripe, stripeTestMode } from "./stripe";
import { BRAND_NAME } from "./brand";
import { buttonMail, sendMail } from "./mail";
import { sendPush } from "./push";
import { planById } from "./plans";
import { canSellMemory, heldMemoryMb } from "./capacity";
import { addonList } from "./addons";
import { fulfillPayment, priceFor } from "./billing";
import type { PeriodDays } from "./periods";

// Gift codes ("Serwer w prezencie"): someone pays for a plan and a period the
// usual way and gets a code by email instead of a server. Whoever gets the code
// makes a new server with it, or adds it to one they have (a free one becomes
// paid, with the same world), without paying. A redeemed code is applied as a
// payment of 0 (fulfillPayment), so plan changes, starting and emails work as
// for any payment.

/** How long a code works after it's paid for. */
export const GIFT_VALID_DAYS = 365;
const DAY = 24 * 60 * 60 * 1000;

// No 0/O, 1/I/L: the code gets read out and typed by hand.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE = /^MC-[A-Z2-9]{4}-[A-Z2-9]{4}$/;

function newCode() {
  const part = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `MC-${part()}-${part()}`;
}

/** " mc-abcd efgh " as typed -> "MC-ABCD-EFGH". */
export function normalizeGiftCode(typed: string) {
  const raw = typed.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = raw.startsWith("MC") ? raw.slice(2) : raw;
  return body.length === 8 ? `MC-${body.slice(0, 4)}-${body.slice(4)}` : typed.trim().toUpperCase();
}

export type GiftError = "giftInvalid" | "giftUsed" | "giftExpired" | "giftUnpaid";

/** The gift a typed code names, if it can still be used. */
export async function usableGift(typed: string, now = new Date()): Promise<{ gift: GiftCode } | { error: GiftError }> {
  const code = normalizeGiftCode(typed);
  if (!CODE.test(code)) return { error: "giftInvalid" };
  const gift = await db.giftCode.findUnique({ where: { code } });
  if (!gift) return { error: "giftInvalid" };
  if (gift.redeemedAt) return { error: "giftUsed" };
  if (!gift.paidAt) return { error: "giftUnpaid" };
  if (gift.expiresAt && gift.expiresAt <= now) return { error: "giftExpired" };
  return { gift };
}

/** Creates a gift code waiting for payment and a Stripe Checkout page for it; returns the page URL. */
export async function startGiftCheckout(opts: {
  user: Pick<User, "id" | "email">;
  plan: Exclude<Plan, "FREE">;
  days: PeriodDays;
  currency: Currency;
  locale: Locale;
  productName: string;
}) {
  const { user, plan, days, currency, locale } = opts;
  if (stripeTestMode() && !(await db.user.count({ where: { id: user.id, admin: true } }))) {
    throw new Error("Stripe runs on test keys: only admins can pay");
  }
  const amount = Math.round(priceFor(plan, days, currency) * 100);
  const payment = await db.payment.create({
    data: { userId: user.id, plan, days, amount, currency, startConsent: true },
  });
  // A clash of two random codes is very unlikely; try again if it happens.
  let gift: GiftCode | null = null;
  for (let i = 0; !gift && i < 5; i++) {
    gift = await db.giftCode
      .create({ data: { code: newCode(), buyerId: user.id, plan, days, paymentId: payment.id } })
      .catch(() => null);
  }
  if (!gift) throw new Error("no free gift code");

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: { currency: currency.toLowerCase(), unit_amount: amount, product_data: { name: opts.productName } },
      },
    ],
    customer_email: user.email,
    client_reference_id: payment.id,
    metadata: { paymentId: payment.id, giftId: gift.id },
    locale,
    success_url: `${appUrl}/prezent?kupiono=${gift.id}`,
    cancel_url: `${appUrl}/prezent?anulowano=1`,
  });
  await db.payment.update({ where: { id: payment.id }, data: { stripeSessionId: session.id } });
  return session.url!;
}

/**
 * Part of applying a payment (fulfillPayment): when it bought a gift code, the
 * code starts working and the buyer gets it by email. Returns false when the
 * payment isn't for a gift. Safe to call more than once.
 */
export async function fulfillGiftPurchase(paymentId: string): Promise<boolean> {
  const gift = await db.giftCode.findUnique({ where: { paymentId } });
  if (!gift) return false;
  const now = new Date();
  const claimed = await db.payment.updateMany({ where: { id: paymentId, status: "PENDING" }, data: { status: "PAID", paidAt: now } });
  if (claimed.count === 0) return true;
  const paid = await db.giftCode.update({
    where: { id: gift.id },
    data: { paidAt: now, expiresAt: new Date(now.getTime() + GIFT_VALID_DAYS * DAY) },
    include: { buyer: { select: { email: true, locale: true } } },
  });
  await sendGiftMail(paid);
  return true;
}

/** Sends the buyer their code, in their language. Never throws. */
async function sendGiftMail(gift: GiftCode & { buyer: Pick<User, "email" | "locale"> }) {
  const locale = isLocale(gift.buyer.locale) ? gift.buyer.locale : defaultLocale;
  const all = messages[locale];
  const t = all.gifts.mail;
  const app = process.env.APP_URL ?? "http://localhost:3000";
  const url = `${app}/prezent/odbierz?kod=${encodeURIComponent(gift.code)}`;
  const vars = {
    code: gift.code,
    plan: all.plans[gift.plan],
    days: gift.days,
    until: gift.expiresAt ? gift.expiresAt.toLocaleDateString(locale, { dateStyle: "long", timeZone: "Europe/Warsaw" }) : "",
    url,
  };
  await sendPush([gift.buyerId], { title: format(t.subject, vars), body: format(t.paragraphs[0], vars), url: "/prezent" });
  try {
    await sendMail(
      buttonMail({
        to: gift.buyer.email,
        subject: format(t.subject, vars),
        paragraphs: t.paragraphs.map((p) => format(p, vars)),
        button: t.button,
        url,
        footer: format(all.planMail.footer, { brand: BRAND_NAME, contact: `${app}/kontakt` }),
      }),
    );
  } catch (err) {
    console.error(`[mail] gift code email for gift ${gift.id} failed:`, err);
  }
}

export type RedeemGiftError = GiftError | "soldOut" | "notFound";

/**
 * Pays for one of the user's servers with a gift code: its plan for the
 * code's days (a free server becomes paid, a paid one is extended or changes
 * plan as with a payment). A new server made with a code is created waiting
 * for payment and paid for here.
 */
export async function redeemGift(
  typed: string,
  userId: string,
  server: Pick<Server, "id" | "ownerId" | "plan" | "memoryMb" | "node" | "addons" | "status">,
  { checkRoom = true } = {},
): Promise<{ error?: RedeemGiftError; gift?: GiftCode }> {
  if (server.ownerId !== userId) return { error: "notFound" };
  const found = await usableGift(typed);
  if ("error" in found) return found;
  const { gift } = found;
  if (checkRoom) {
    // As when paying: the extra memory on its machine, or the whole plan on one it can move to.
    const planMb = planById(gift.plan).ramGb * 1024;
    if (!(await canSellMemory(planMb - heldMemoryMb(server), planMb, server.node)) && !(await canSellMemory(planMb))) {
      return { error: "soldOut" };
    }
  }
  // Claimed first, so the same code can't pay for two servers.
  const now = new Date();
  const claim = await db.giftCode.updateMany({
    where: { id: gift.id, redeemedAt: null },
    data: { redeemedAt: now, redeemedById: userId, serverId: server.id },
  });
  if (claim.count === 0) return { error: "giftUsed" };
  let paymentId: string | null = null;
  try {
    const payment = await db.payment.create({
      data: {
        userId,
        serverId: server.id,
        plan: gift.plan,
        days: gift.days,
        amount: 0,
        currency: "PLN",
        startConsent: true,
        // Add-ons the server already has stay on.
        addons: addonList(server.addons),
        redeemedGiftId: gift.id,
      },
    });
    paymentId = payment.id;
    await fulfillPayment(payment.id);
  } catch (err) {
    console.error("redeeming gift failed", gift.id, server.id, err);
    // Once the plan is on the server the code stays used; the billing job finishes starting it.
    const applied = paymentId && (await db.payment.count({ where: { id: paymentId, status: "PAID" } }));
    if (applied) return { gift };
    if (paymentId) await db.payment.updateMany({ where: { id: paymentId, status: "PENDING" }, data: { status: "FAILED" } });
    await db.giftCode.updateMany({ where: { id: gift.id, redeemedAt: now }, data: { redeemedAt: null, redeemedById: null, serverId: null } });
    throw err;
  }
  return { gift };
}
