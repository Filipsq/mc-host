import "server-only";
import type { Plan, Server, ServerStatus, User } from "@prisma/client";
import { db } from "./db";
import { stripe } from "./stripe";
import * as agent from "./agent";
import { agentSpec } from "./servers";
import { planById } from "./plans";
import { canSellMemory } from "./capacity";
import { diskLimitMb } from "./disk";
import { REMIND_BEFORE_DAYS, sendPlanMail } from "./planMail";
import type { Currency, Locale } from "@/i18n/config";

// Paid plans are prepaid in 30-day blocks rather than auto-renewing
// subscriptions: BLIK and Przelewy24 can't charge automatically, and
// prepaid "extend your server" is what Polish players are used to.

const DAY = 24 * 60 * 60 * 1000;
// What the plan emails need to know about the server's owner.
const OWNER = { owner: { select: { email: true, locale: true } } } as const;
export const PERIOD_MONTHS = [1, 3] as const;
export type PeriodMonths = (typeof PERIOD_MONTHS)[number];

export function priceFor(plan: Plan, months: number, currency: Currency) {
  return planById(plan).price[currency] * months;
}

/** Creates a pending payment and a Stripe Checkout page for it; returns the page URL. */
export async function startCheckout(opts: {
  user: Pick<User, "id" | "email">;
  server: Pick<Server, "id" | "name">;
  plan: Plan;
  months: PeriodMonths;
  currency: Currency;
  locale: Locale;
  productName: string;
  startConsent: boolean; // asked for the server to start before the withdrawal period ends
}) {
  const { user, server, plan, months, currency, locale, startConsent } = opts;
  const amount = Math.round(priceFor(plan, months, currency) * 100);
  const payment = await db.payment.create({
    data: { userId: user.id, serverId: server.id, plan, months, amount, currency, startConsent },
  });

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const back = `${appUrl}/dashboard/servers/${server.id}`;
  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    // Card, BLIK and Przelewy24 are switched on in the Stripe Dashboard;
    // Stripe shows the ones that work for this currency (BLIK needs PLN).
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: currency.toLowerCase(),
          unit_amount: amount,
          product_data: { name: opts.productName },
        },
      },
    ],
    customer_email: user.email,
    client_reference_id: payment.id,
    metadata: { paymentId: payment.id, serverId: server.id },
    locale,
    success_url: `${back}?payment=success`,
    cancel_url: `${back}?payment=cancelled`,
  });

  await db.payment.update({ where: { id: payment.id }, data: { stripeSessionId: session.id } });
  return session.url!;
}

/**
 * Applies a successful payment: extends or changes the server's plan, then
 * makes the game host match. Safe to call more than once for the same payment.
 */
export async function fulfillPayment(paymentId: string) {
  const now = new Date();
  const server = await db.$transaction(async (tx) => {
    // Claim the payment first so a retried webhook can't apply it twice.
    const claimed = await tx.payment.updateMany({
      where: { id: paymentId, status: "PENDING" },
      data: { status: "PAID", paidAt: now },
    });
    if (claimed.count === 0) return null;
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { server: true } });
    const server = payment.server;
    if (!server) return null; // deleted before the payment went through

    const paidUntil = new Date(creditStart(server, payment.plan, now).getTime() + payment.months * 30 * DAY);
    const planChanged = server.plan !== payment.plan;
    const needsHost = planChanged || server.status === "AWAITING_PAYMENT" || server.status === "SUSPENDED";
    return tx.server.update({
      where: { id: server.id },
      data: {
        plan: payment.plan,
        memoryMb: planById(payment.plan).ramGb * 1024,
        paidUntil,
        ...(needsHost && { status: "PROVISIONING" }),
      },
      include: OWNER,
    });
  });
  if (!server) return;

  // Before provisioning, which may wait for an image download.
  await sendPlanMail("paid", server);
  if (server.status === "PROVISIONING") await provision(server);
}

export type GiftResult = { error?: "free" | "soldOut" | "failed"; server?: Server };

/**
 * An admin's gift: extends the paid period by `days` without a payment (e.g.
 * to make up for downtime), starting the server if it's suspended or unpaid.
 */
export async function giftDays(serverId: string, days: number): Promise<GiftResult> {
  const now = new Date();
  const s = await db.server.findUnique({ where: { id: serverId } });
  if (!s) return {};
  if (s.plan === "FREE") return { error: "free" };
  const needsHost = s.status === "AWAITING_PAYMENT" || s.status === "SUSPENDED";
  if (needsHost && !(await canSellMemory(s.memoryMb))) return { error: "soldOut" };
  const from = s.paidUntil && s.paidUntil > now ? s.paidUntil : now;
  const server = await db.server.update({
    where: { id: s.id },
    data: { paidUntil: new Date(from.getTime() + days * DAY), ...(needsHost && { status: "PROVISIONING" }) },
  });
  console.info("admin gift", server.id, days, "days, paid until", server.paidUntil?.toISOString());
  if (server.status === "PROVISIONING" && !(await provision(server))) return { error: "failed", server };
  return { server };
}

/**
 * Where the new paid period starts. Extending the same plan adds to the end;
 * switching plans converts the days left into days of the new plan by price.
 */
function creditStart(server: Server, newPlan: Plan, now: Date) {
  const remaining = server.paidUntil && server.plan !== "FREE" ? server.paidUntil.getTime() - now.getTime() : 0;
  if (remaining <= 0) return now;
  if (server.plan === newPlan) return server.paidUntil!;
  const ratio = planById(server.plan).price.PLN / planById(newPlan).price.PLN;
  return new Date(now.getTime() + remaining * ratio);
}

/** Creates or rebuilds the container for the server's current plan. */
export async function provision(server: Server) {
  try {
    await agent.recreateServer(agentSpec(server));
    await db.server.update({ where: { id: server.id }, data: { status: "RUNNING", pluginsPending: false } });
    return true;
  } catch (err) {
    // Left in PROVISIONING; the billing job retries.
    console.error("provision failed", server.id, err);
    return false;
  }
}

export async function markPayment(sessionId: string, status: "FAILED" | "EXPIRED") {
  await db.payment.updateMany({ where: { stripeSessionId: sessionId, status: "PENDING" }, data: { status } });
}

/** Periodic housekeeping, run by /api/cron/billing. */
export async function runBillingJob(now = new Date()) {
  const result = { suspended: 0, reminded: 0, abandoned: 0, provisioned: 0 };
  const onHost: ServerStatus[] = ["RUNNING", "STOPPED", "PROVISIONING"];

  // Paid period over: stop the server but keep its world.
  const expired = await db.server.findMany({
    where: { plan: { not: "FREE" }, paidUntil: { lt: now }, status: { in: onHost } },
    include: OWNER,
  });
  for (const s of expired) {
    await agent.stopServer(s.id, "suspended").catch((err) => {
      if (!(err instanceof agent.AgentError && err.status === 404)) throw err;
    });
    // Unless it was renewed meanwhile, or another run got here first.
    const { count } = await db.server.updateMany({
      where: { id: s.id, paidUntil: { lt: now }, status: { in: onHost } },
      data: { status: "SUSPENDED" },
    });
    if (count === 0) continue;
    result.suspended++;
    await sendPlanMail("suspended", s);
  }

  // A paid period ends in a few days: remind the owner, once per period.
  const ending = await db.server.findMany({
    where: {
      plan: { not: "FREE" },
      status: { in: onHost },
      paidUntil: { gt: now, lte: new Date(now.getTime() + REMIND_BEFORE_DAYS * DAY) },
    },
    include: OWNER,
  });
  for (const s of ending) {
    if (s.reminderSentFor?.getTime() === s.paidUntil!.getTime()) continue;
    // Claim it first, so overlapping runs don't both send; give it back if sending fails.
    const claim = await db.server.updateMany({
      where: { id: s.id, paidUntil: s.paidUntil, OR: [{ reminderSentFor: null }, { reminderSentFor: { not: s.paidUntil } }] },
      data: { reminderSentFor: s.paidUntil },
    });
    if (claim.count === 0) continue;
    if (await sendPlanMail("reminder", s)) result.reminded++;
    else await db.server.updateMany({ where: { id: s.id, reminderSentFor: s.paidUntil }, data: { reminderSentFor: s.reminderSentFor } });
  }

  // Servers created for a payment that never happened free their port and address.
  const abandoned = await db.server.findMany({
    where: { status: "AWAITING_PAYMENT", createdAt: { lt: new Date(now.getTime() - DAY) } },
  });
  for (const s of abandoned) {
    await db.server.delete({ where: { id: s.id } });
    result.abandoned++;
  }

  // Paid (or free) servers whose container couldn't be created yet.
  const stuck = await db.server.findMany({
    where: { status: "PROVISIONING", updatedAt: { lt: new Date(now.getTime() - 60_000) } },
  });
  for (const s of stuck) if (await provision(s)) result.provisioned++;

  await db.payment.updateMany({
    where: { status: "PENDING", createdAt: { lt: new Date(now.getTime() - DAY) } },
    data: { status: "EXPIRED" },
  });

  // Every server's disk limit, so the agent has them all (also servers made before
  // there were limits, and after its state was lost).
  const onAgent = await db.server.findMany({
    where: { status: { not: "AWAITING_PAYMENT" } },
    select: { id: true, plan: true },
  });
  await agent
    .setDiskLimits(Object.fromEntries(onAgent.map((s) => [s.id, diskLimitMb(s.plan)])))
    .catch((err) => console.error("disk limits not sent", err));
  return result;
}
