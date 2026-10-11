import "server-only";
import type { Plan, Server, User } from "@prisma/client";
import { db } from "./db";
import { stripe } from "./stripe";
import * as agent from "./agent";
import { agentSpec } from "./servers";
import { planById } from "./plans";
import type { Currency, Locale } from "@/i18n/config";

// Paid plans are prepaid in 30-day blocks rather than auto-renewing
// subscriptions: BLIK and Przelewy24 can't charge automatically, and
// prepaid "extend your server" is what Polish players are used to.

const DAY = 24 * 60 * 60 * 1000;
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
}) {
  const { user, server, plan, months, currency, locale } = opts;
  const amount = Math.round(priceFor(plan, months, currency) * 100);
  const payment = await db.payment.create({
    data: { userId: user.id, serverId: server.id, plan, months, amount, currency },
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
    // Groups these sessions in the Dashboard; the suffix keeps the label unique to this flow.
    integration_identifier: "server-plan-qkzmwrbt",
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
      where: { id: paymentId, status: { in: ["PENDING", "PROCESSING"] } },
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
    });
  });

  if (server?.status === "PROVISIONING") await provision(server);
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
    await db.server.update({ where: { id: server.id }, data: { status: "RUNNING" } });
    return true;
  } catch (err) {
    // Left in PROVISIONING; the billing job retries.
    console.error("provision failed", server.id, err);
    return false;
  }
}

export async function markPayment(sessionId: string, status: "FAILED" | "EXPIRED") {
  await db.payment.updateMany({
    where: { stripeSessionId: sessionId, status: { in: ["PENDING", "PROCESSING"] } },
    data: { status },
  });
}

/** The customer paid with a delayed method; keep the payment (and its server) until Stripe settles it. */
export async function markProcessing(paymentId: string) {
  await db.payment.updateMany({ where: { id: paymentId, status: "PENDING" }, data: { status: "PROCESSING" } });
}

/** Periodic housekeeping, run by /api/cron/billing. */
export async function runBillingJob(now = new Date()) {
  const result = { suspended: 0, abandoned: 0, provisioned: 0 };

  // Paid period over: stop the server but keep its world.
  const expired = await db.server.findMany({
    where: { plan: { not: "FREE" }, paidUntil: { lt: now }, status: { in: ["RUNNING", "STOPPED", "PROVISIONING"] } },
  });
  for (const s of expired) {
    await agent.stopServer(s.id).catch((err) => {
      if (!(err instanceof agent.AgentError && err.status === 404)) throw err;
    });
    await db.server.update({ where: { id: s.id }, data: { status: "SUSPENDED" } });
    result.suspended++;
  }

  // Servers created for a payment that never happened free their port and address.
  // One whose BLIK or Przelewy24 payment is still settling is kept.
  const abandoned = await db.server.findMany({
    where: {
      status: "AWAITING_PAYMENT",
      createdAt: { lt: new Date(now.getTime() - DAY) },
      payments: { none: { status: "PROCESSING" } },
    },
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
  return result;
}
