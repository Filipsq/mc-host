import "server-only";
import type { Server } from "@prisma/client";
import { db } from "./db";
import { stripe } from "./stripe";
import { fulfillPayment, priceFor } from "./billing";
import { PERIOD_DAYS, type PeriodDays } from "./periods";
import { sendPlanMail } from "./planMail";
import { serverAddons } from "./addons";
import type { Currency } from "@/i18n/config";

// Automatic renewal: an owner who paid by card and asked for it has the card
// charged for another period of the current plan a day before the paid period
// ends. Only cards can do this; BLIK and Przelewy24 need the payer each time.
// A charge that fails turns renewal off and tells the owner to pay by hand.

const DAY = 24 * 60 * 60 * 1000;
/** How long before the end of the paid period the card is charged. */
export const RENEW_BEFORE_MS = DAY;

/** Charges every auto-renewing server whose period ends within RENEW_BEFORE_MS. Returns how many were renewed. */
export async function renewDueServers(now = new Date()) {
  const due = await db.server.findMany({
    where: {
      autoRenew: true,
      renewCard: { not: null },
      plan: { not: "FREE" },
      status: { in: ["RUNNING", "STOPPED", "PROVISIONING"] },
      paidUntil: { gt: now, lte: new Date(now.getTime() + RENEW_BEFORE_MS) },
    },
    include: { owner: { select: { email: true, locale: true, stripeCustomerId: true } } },
  });
  let renewed = 0;
  for (const s of due) {
    if (s.renewTriedFor?.getTime() === s.paidUntil!.getTime()) continue;
    // Claim this period first, so overlapping runs never charge twice.
    const claim = await db.server.updateMany({
      where: { id: s.id, paidUntil: s.paidUntil, OR: [{ renewTriedFor: null }, { renewTriedFor: { not: s.paidUntil } }] },
      data: { renewTriedFor: s.paidUntil },
    });
    if (claim.count === 0) continue;
    if (await renew(s, s.owner.stripeCustomerId)) renewed++;
  }
  return renewed;
}

async function renew(server: Server & { owner: { email: string; locale: string } }, customer: string | null) {
  const days = (PERIOD_DAYS as readonly number[]).includes(server.renewDays ?? 0) ? (server.renewDays as PeriodDays) : 30;
  const currency = (server.renewCurrency ?? "PLN") as Currency;
  const addons = serverAddons(server);
  const amount = Math.round(priceFor(server.plan, days, currency, addons) * 100);
  const payment = await db.payment.create({
    data: { userId: server.ownerId, serverId: server.id, plan: server.plan, days, amount, currency, startConsent: true, renewal: true, addons },
  });
  let succeeded = false;
  try {
    if (!customer || !server.renewCard) throw new Error("no saved card");
    const intent = await stripe().paymentIntents.create(
      {
        amount,
        currency: currency.toLowerCase(),
        customer,
        payment_method: server.renewCard,
        off_session: true,
        confirm: true,
        description: `${server.name}: ${days} days`,
        metadata: { paymentId: payment.id, serverId: server.id, renewal: "1" },
      },
      // A retried request never charges twice.
      { idempotencyKey: `renew-${payment.id}` },
    );
    await db.payment.update({ where: { id: payment.id }, data: { stripePaymentIntentId: intent.id } });
    // Cards almost always answer at once; a slower one finishes in the webhook.
    if (intent.status !== "succeeded" && intent.status !== "processing") throw new Error(`payment intent ${intent.status}`);
    succeeded = intent.status === "succeeded";
  } catch (err) {
    // Declined, expired, or the bank wants the owner to confirm: they pay by hand instead.
    console.error("automatic renewal failed", server.id, err);
    await db.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "FAILED" } });
    const off = await db.server.update({ where: { id: server.id }, data: { autoRenew: false }, include: { owner: { select: { email: true, locale: true } } } });
    await sendPlanMail("renewFailed", off);
    return false;
  }
  if (succeeded) await fulfillPayment(payment.id);
  console.info("renewed", server.id, days, "days");
  return true;
}
