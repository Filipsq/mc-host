import "server-only";
import type { Payment, Plan, Prisma, Server, ServerStatus, User } from "@prisma/client";
import { db } from "./db";
import { stripe } from "./stripe";
import * as agent from "./agent";
import { agentSpec, destroyServer } from "./servers";
import { planById } from "./plans";
import { periodPrice, type PeriodDays } from "./periods";
import { canSellMemory } from "./capacity";
import { diskLimitMb } from "./disk";
import { KEEP_DAYS, REMIND_BEFORE_DAYS, WARN_BEFORE_DELETE_DAYS, sendPlanMail } from "./planMail";
import { REFERRAL_DAYS, claimReferral, sendReferralMail, type Inviter } from "./referrals";
import type { Currency, Locale } from "@/i18n/config";

// Paid plans are prepaid for 7 to 90 days (periods.ts) rather than auto-renewing
// subscriptions: BLIK and Przelewy24 can't charge automatically, and
// prepaid "extend your server" is what Polish players are used to.

const DAY = 24 * 60 * 60 * 1000;
// What the plan emails need to know about the server's owner.
const OWNER = { owner: { select: { email: true, locale: true } } } as const;
export function priceFor(plan: Plan, days: PeriodDays, currency: Currency) {
  return periodPrice(planById(plan).price[currency], days);
}

/** Creates a pending payment and a Stripe Checkout page for it; returns the page URL. */
export async function startCheckout(opts: {
  user: Pick<User, "id" | "email">;
  server: Pick<Server, "id" | "name">;
  plan: Plan;
  days: PeriodDays;
  currency: Currency;
  locale: Locale;
  productName: string;
  startConsent: boolean; // asked for the server to start before the withdrawal period ends
}) {
  const { user, server, plan, days, currency, locale, startConsent } = opts;
  const amount = Math.round(priceFor(plan, days, currency) * 100);
  const payment = await db.payment.create({
    data: { userId: user.id, serverId: server.id, plan, days, amount, currency, startConsent },
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
  let inviter: Inviter | null = null;
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

    // A friend's invite: the first long enough payment gets extra days, and so does whoever invited them.
    inviter = await claimReferral(tx, payment.userId, payment.days);
    const days = payment.days + (inviter ? REFERRAL_DAYS : 0);
    const paidUntil = new Date(creditStart(server, payment.plan, now).getTime() + days * DAY);
    const planChanged = server.plan !== payment.plan;
    const needsHost = planChanged || server.status === "AWAITING_PAYMENT" || server.status === "SUSPENDED";
    return tx.server.update({
      where: { id: server.id },
      data: {
        plan: payment.plan,
        memoryMb: planById(payment.plan).ramGb * 1024,
        paidUntil,
        deletionWarnedAt: null,
        ...(needsHost && { status: "PROVISIONING" }),
      },
      include: OWNER,
    });
  });
  if (!server) return;

  // Before provisioning, which may wait for an image download.
  await sendPlanMail("paid", server);
  if (inviter) await sendReferralMail(inviter);
  if (server.status === "PROVISIONING") await provision(server);
}

export type GiftResult = { error?: "free" | "soldOut" | "failed"; server?: Server };

/**
 * Extends the paid period by `days` without a payment, starting the server if
 * it's suspended or unpaid: an admin's gift (e.g. to make up for downtime) or
 * days its owner got for inviting a friend.
 */
export async function giftDays(serverId: string, days: number, why = "admin gift"): Promise<GiftResult> {
  const now = new Date();
  const s = await db.server.findUnique({ where: { id: serverId } });
  if (!s) return {};
  if (s.plan === "FREE") return { error: "free" };
  const needsHost = s.status === "AWAITING_PAYMENT" || s.status === "SUSPENDED";
  if (needsHost && !(await canSellMemory(s.memoryMb))) return { error: "soldOut" };
  const from = s.paidUntil && s.paidUntil > now ? s.paidUntil : now;
  const server = await db.server.update({
    where: { id: s.id },
    data: {
      paidUntil: new Date(from.getTime() + days * DAY),
      deletionWarnedAt: null,
      ...(needsHost && { status: "PROVISIONING" }),
    },
  });
  console.info(why, server.id, days, "days, paid until", server.paidUntil?.toISOString());
  if (server.status === "PROVISIONING" && !(await provision(server))) return { error: "failed", server };
  return { server };
}

/**
 * When a suspended server is deleted: KEEP_DAYS after its paid period ended,
 * and never sooner than WARN_BEFORE_DELETE_DAYS after its owner was told
 * (or, not told yet, after now).
 */
export function deletionDate(server: Pick<Server, "paidUntil" | "deletionWarnedAt">, now = new Date()) {
  const kept = (server.paidUntil?.getTime() ?? now.getTime()) + KEEP_DAYS * DAY;
  const toldAt = server.deletionWarnedAt?.getTime() ?? now.getTime();
  return new Date(Math.max(kept, toldAt + WARN_BEFORE_DELETE_DAYS * DAY));
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

// Checkouts made with Stripe test keys: no real money moved.
export const TEST_PAYMENTS = { stripeSessionId: { startsWith: "cs_test_" } } satisfies Prisma.PaymentWhereInput;
// What the admin may delete: test payments and ones that never went through.
// Real paid (or still open) payments stay in the history for the accounts.
export const REMOVABLE_PAYMENTS = {
  OR: [TEST_PAYMENTS, { status: { in: ["FAILED", "EXPIRED"] } }],
} satisfies Prisma.PaymentWhereInput;

export function isTestPayment(p: Pick<Payment, "stripeSessionId">) {
  return !!p.stripeSessionId?.startsWith("cs_test_");
}

export function isRemovablePayment(p: Pick<Payment, "stripeSessionId" | "status">) {
  return isTestPayment(p) || p.status === "FAILED" || p.status === "EXPIRED";
}

/** Periodic housekeeping, run by /api/cron/billing. */
export async function runBillingJob(now = new Date()) {
  const result = { suspended: 0, reminded: 0, warned: 0, deleted: 0, abandoned: 0, provisioned: 0 };
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

  // Suspended for long: the owner is warned, and a few days later the server is
  // deleted with its world and backups (the terms keep them KEEP_DAYS).
  const stale = await db.server.findMany({
    where: {
      status: "SUSPENDED",
      paidUntil: { lt: new Date(now.getTime() - (KEEP_DAYS - WARN_BEFORE_DELETE_DAYS) * DAY) },
    },
    include: OWNER,
  });
  for (const s of stale) {
    if (!s.deletionWarnedAt) {
      const claim = await db.server.updateMany({
        where: { id: s.id, status: "SUSPENDED", deletionWarnedAt: null },
        data: { deletionWarnedAt: now },
      });
      if (claim.count === 0) continue;
      if (await sendPlanMail("deletion", s, deletionDate({ ...s, deletionWarnedAt: now }, now))) result.warned++;
      else await db.server.updateMany({ where: { id: s.id, deletionWarnedAt: now }, data: { deletionWarnedAt: null } });
      continue;
    }
    if (deletionDate(s, now) > now) continue;
    // Someone may be paying for it right now: wait for that checkout to end.
    const paying = await db.payment.count({ where: { serverId: s.id, status: "PENDING" } });
    const still = await db.server.count({ where: { id: s.id, status: "SUSPENDED" } });
    if (paying > 0 || still === 0) continue;
    try {
      await destroyServer(s);
      console.info("deleted suspended server", s.id, "paid until", s.paidUntil?.toISOString());
      result.deleted++;
    } catch (err) {
      console.error("deleting suspended server failed", s.id, err);
    }
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
