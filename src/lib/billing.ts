import "server-only";
import type { Payment, Plan, Prisma, Server, ServerStatus, User } from "@prisma/client";
import { db } from "./db";
import { stripe, stripeTestMode } from "./stripe";
import * as agent from "./agent";
import { agentSpec, changePort, destroyServer, moveIfFull, syncHostAliases, syncPeerRoutes } from "./servers";
import { planById } from "./plans";
import { nodes } from "./nodes";
import { periodPrice, type PeriodDays } from "./periods";
import { canSellMemory } from "./capacity";
import { diskLimitMb } from "./disk";
import { addonList, monthlyWithAddons, type AddonId } from "./addons";
import {
  KEEP_DAYS,
  REMIND_BEFORE_DAYS,
  WARN_BEFORE_DELETE_DAYS,
  sendPlanMail,
} from "./planMail";
import { sendComebackReminders } from "./comeback";
import { renewDueServers } from "./renewal";
import { REFERRAL_DAYS, claimReferral, sendReferralMail, type Inviter } from "./referrals";
import { countCreatorServer, sendCreatorRewardMail, withCreatorDiscount, type CreatorReward } from "./creator";
import { fulfillGiftPurchase } from "./gifts";
import { isHalloweenCode, withHalloweenDiscount } from "./halloween";
import { startOffers, startOfferEnds, withStartOfferDiscount } from "./startOffer";
import type { Currency, Locale } from "@/i18n/config";

// Paid plans are prepaid for 7 to 90 days (periods.ts) rather than auto-renewing
// subscriptions: BLIK and Przelewy24 can't charge automatically, and
// prepaid "extend your server" is what Polish players are used to.

const DAY = 24 * 60 * 60 * 1000;
// What the plan emails need to know about the server's owner.
const OWNER = { owner: { select: { email: true, locale: true } } } as const;
/** What `days` of the plan cost, with the add-ons (addons.ts). */
export function priceFor(plan: Plan, days: PeriodDays, currency: Currency, addons: readonly AddonId[] = []) {
  return periodPrice(monthlyWithAddons(plan, addons, currency), days);
}

/** Creates a pending payment and a Stripe Checkout page for it; returns the page URL. */
export async function startCheckout(opts: {
  user: Pick<User, "id" | "email">;
  server: Pick<Server, "id" | "name">;
  plan: Plan;
  days: PeriodDays | 0; // 0 for an upgrade
  currency: Currency;
  locale: Locale;
  productName: string;
  startConsent: boolean; // asked for the server to start before the withdrawal period ends
  autoRenew?: boolean; // save the card and renew automatically (renewal.ts)
  upgrade?: { from: Plan; amount: number }; // the price difference for the time left (upgrade.ts); days is 0
  addons?: readonly AddonId[]; // every add-on the server has once paid (addons.ts)
  addonsOnly?: { amount: number }; // add-ons bought for the time left (addonCost); days is 0
  creatorId?: string; // a creator code was entered (creator.ts): a new server's first payment costs less
  promoCode?: string; // the Halloween code (halloween.ts): the same, without a creator
}) {
  const { user, server, plan, days, currency, locale, startConsent, upgrade, addonsOnly } = opts;
  const addons = addonList(opts.addons);
  const autoRenew = !!opts.autoRenew && !upgrade && !addonsOnly;
  // Test keys take no money, so only admins may check out with them (to try the site).
  if (stripeTestMode() && !(await db.user.count({ where: { id: user.id, admin: true } }))) {
    throw new Error("Stripe runs on test keys: only admins can pay");
  }
  const full = Math.round((upgrade || addonsOnly || !days ? (upgrade?.amount ?? addonsOnly?.amount ?? 0) : priceFor(plan, days, currency, addons)) * 100);
  const creatorId = days && !upgrade && !addonsOnly ? opts.creatorId : undefined;
  const promoCode = days && !upgrade && !addonsOnly && !creatorId && opts.promoCode && isHalloweenCode(opts.promoCode) ? opts.promoCode : undefined;
  // Without a code, a first payment while the user's start offer runs (startOffer.ts) is cheaper too.
  const startOffer = days && !upgrade && !addonsOnly && !creatorId && !promoCode && (await startOfferEnds(user.id)) ? "start" : undefined;
  const amount = creatorId ? withCreatorDiscount(full) : promoCode ? withHalloweenDiscount(full) : startOffer ? withStartOfferDiscount(full) : full;
  const payment = await db.payment.create({
    data: {
      userId: user.id,
      serverId: server.id,
      plan,
      days,
      amount,
      currency,
      startConsent,
      autoRenew,
      upgradeFrom: upgrade?.from,
      addons,
      addonsOnly: !!addonsOnly,
      creatorId,
      promoCode: promoCode ?? startOffer,
    },
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
    // A card paid with is kept for automatic renewal; BLIK and Przelewy24 can't be charged again.
    ...(autoRenew
      ? { customer: await stripeCustomer(user), payment_method_options: { card: { setup_future_usage: "off_session" as const } } }
      : { customer_email: user.email }),
    client_reference_id: payment.id,
    metadata: { paymentId: payment.id, serverId: server.id },
    locale,
    success_url: `${back}?payment=success`,
    cancel_url: `${back}?payment=cancelled`,
  });

  await db.payment.update({ where: { id: payment.id }, data: { stripeSessionId: session.id } });
  return session.url!;
}

/** The user's Stripe customer, made the first time they save a card. */
export async function stripeCustomer(user: Pick<User, "id" | "email">) {
  const { stripeCustomerId } = await db.user.findUniqueOrThrow({ where: { id: user.id }, select: { stripeCustomerId: true } });
  if (stripeCustomerId) return stripeCustomerId;
  const customer = await stripe().customers.create({ email: user.email, metadata: { userId: user.id } });
  await db.user.update({ where: { id: user.id }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

/**
 * Applies a successful payment: extends or changes the server's plan, then
 * makes the game host match. Safe to call more than once for the same payment.
 */
export async function fulfillPayment(paymentId: string) {
  // A gift code bought for someone (gifts.ts): no server to change yet.
  if (await fulfillGiftPurchase(paymentId)) return;
  const now = new Date();
  let inviter: Inviter | null = null;
  let creator: CreatorReward | null = null;
  let addonsChanged = false;
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
    // Bought with a creator code: counts for its owner once paid for long enough.
    creator = await countCreatorServer(tx, server, payment.days);
    const days = payment.days + (inviter ? REFERRAL_DAYS : 0) + (await claimApologyDays(tx, payment.userId));
    const paidUntil = upgradedUntil(server, payment, now) ?? new Date(creditStart(server, payment.plan, now).getTime() + days * DAY);
    const planChanged = server.plan !== payment.plan;
    // More backups are kept by the container, so it's rebuilt for them; disk and domain are sent below.
    const backupsChanged = server.addons.includes("backups") !== payment.addons.includes("backups");
    addonsChanged = addonList(server.addons).join() !== addonList(payment.addons).join();
    const needsHost = planChanged || backupsChanged || server.status === "AWAITING_PAYMENT" || server.status === "SUSPENDED";
    return tx.server.update({
      where: { id: server.id },
      data: {
        plan: payment.plan,
        addons: addonList(payment.addons),
        // Without the domain add-on any more, players use the mchosting.pl address again.
        ...(!payment.addons.includes("domain") && { customDomain: null }),
        memoryMb: planById(payment.plan).ramGb * 1024,
        paidUntil,
        deletionWarnedAt: null,
        ...(needsHost && { status: "PROVISIONING" }),
      },
      include: OWNER,
    });
  });
  if (!server) return;

  // The card paid with, kept for automatic renewal if the buyer asked for it.
  const saved = await saveRenewalCard(paymentId);
  // Before provisioning, which may wait for an image download.
  await sendPlanMail("paid", saved ?? server);
  if (inviter) await sendReferralMail(inviter);
  if (creator) await sendCreatorRewardMail(creator);
  if (addonsChanged) {
    await syncDiskLimits().catch((err) => console.error("disk limits not sent", err));
    await syncHostAliases().catch((err) => console.error("host aliases not sent", err));
  }
  if (server.status === "PROVISIONING") await provision(server);
}

/** Tells the machines every server's disk limit (also servers made before there were limits, and after an agent lost its state). */
export async function syncDiskLimits() {
  const onAgent = await db.server.findMany({
    where: { status: { not: "AWAITING_PAYMENT" } },
    select: { id: true, plan: true, addons: true },
  });
  await agent.setDiskLimits(Object.fromEntries(onAgent.map((s) => [s.id, diskLimitMb(s)])));
}

/**
 * Where an upgrade leaves the paid period: where it was, since only the
 * difference was paid. If the period changed since the checkout began (it ran
 * out, or the plan changed), what was paid becomes days of the new plan instead.
 */
function upgradedUntil(server: Server, payment: Payment, now: Date): Date | null {
  if (!payment.upgradeFrom && !payment.addonsOnly) return null;
  const from = payment.upgradeFrom ?? payment.plan;
  if (server.plan === from && server.paidUntil && server.paidUntil > now) return server.paidUntil;
  const perDay = monthlyWithAddons(payment.plan, addonList(payment.addons), payment.currency as Currency) / 30;
  const days = perDay > 0 ? payment.amount / 100 / perDay : 0;
  return new Date(creditStart(server, payment.plan, now).getTime() + days * DAY);
}

/**
 * After a Checkout payment where the buyer asked for automatic renewal: keeps
 * the card it was paid with on the server. Paid with BLIK or Przelewy24, there
 * is nothing to keep. Returns the server when it changed; never throws.
 */
async function saveRenewalCard(paymentId: string) {
  try {
    const payment = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (!payment.autoRenew || !payment.serverId || !payment.stripeSessionId) return null;
    const session = await stripe().checkout.sessions.retrieve(payment.stripeSessionId, { expand: ["payment_intent.payment_method"] });
    const intent = session.payment_intent;
    const method = intent && typeof intent !== "string" ? intent.payment_method : null;
    if (!method || typeof method === "string" || method.type !== "card" || !method.card) return null;
    const brand = method.card.brand.charAt(0).toUpperCase() + method.card.brand.slice(1);
    return await db.server.update({
      where: { id: payment.serverId },
      data: {
        autoRenew: true,
        renewDays: payment.days,
        renewCurrency: payment.currency,
        renewCard: method.id,
        renewCardLabel: `${brand} •••• ${method.card.last4}`,
      },
      include: OWNER,
    });
  } catch (err) {
    console.error("saving the renewal card failed", paymentId, err);
    return null;
  }
}

/** Days the payer gets on top to make up for a payment of theirs that didn't go through (testPayments.ts), once. */
async function claimApologyDays(tx: Prisma.TransactionClient, userId: string) {
  const { apologyDays } = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { apologyDays: true } });
  if (apologyDays <= 0) return 0;
  const { count } = await tx.user.updateMany({ where: { id: userId, apologyDays }, data: { apologyDays: 0 } });
  return count ? apologyDays : 0;
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
  if (needsHost && !(await canSellMemory(s.memoryMb, s.memoryMb))) return { error: "soldOut" };
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
 * Notes when players were last on each server (from the machines' stats), asks
 * owners of servers nobody played on for COMEBACK_DAYS to come back
 * (comeback.ts) and offers regular free players a cheaper first payment.
 * Free servers are never deleted for being idle.
 */
async function trackPlayers(now: Date, result: { comeback: number; startOffers: number }) {
  const stats = await agent.getStats().catch((err) => {
    console.error("player tracking: no stats", err);
    return null;
  });
  // Without knowing who's playing, nobody is judged idle.
  if (!stats) return;
  const playing = stats.servers.filter((s) => (s.players ?? 0) > 0).map((s) => s.id);
  if (playing.length > 0) {
    await db.server.updateMany({ where: { id: { in: playing } }, data: { lastPlayedAt: now, comebackSentAt: null } });
  }
  // A few days with nobody playing: ask the owner to come back (paid servers too).
  result.comeback += await sendComebackReminders(now, stats.unreachable).catch((err) => {
    console.error("comeback reminders failed", err);
    return 0;
  });
  // Someone keeps playing on a free server: offer them a cheaper first payment.
  result.startOffers += await startOffers(now, playing).catch((err) => {
    console.error("start offers failed", err);
    return 0;
  });
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
    // Its machine may have no room left for the new plan: then it goes to one that has.
    const here = await moveIfFull(server);
    if (!here) return false; // being moved; the call moving it provisions it
    server = here;
    // Something on the machine may hold its port: then it gets the next free one.
    for (const busy = new Set<number>(); ; ) {
      try {
        await agent.recreateServer(agentSpec(server));
        break;
      } catch (err) {
        if (!agent.portInUse(err) || server.port === null || busy.size >= 5) throw err;
        busy.add(server.port);
        const moved = await changePort(server, busy);
        if (!moved) throw err;
        server = moved;
      }
    }
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
// Old enough that no creation or move (at most 2 hours) is still working on it.
const LEFTOVER_AFTER_MS = 6 * 60 * 60_000;

/**
 * Removes containers the site no longer knows on a machine: left by a creation
 * that failed half-way, or a moved server's stopped old copy. A stopped one
 * still holds its ports, which a new server would be given, so its start fails.
 * Only the container goes; its files stay on the disk.
 */
export async function removeLeftoverContainers(now = new Date()) {
  const home = new Map((await db.server.findMany({ select: { id: true, node: true } })).map((s) => [s.id, s.node]));
  let removed = 0;
  for (const node of nodes()) {
    const list = await agent.listContainers(node).catch((err) => {
      console.error(`containers on ${node.id} not listed`, err);
      return [];
    });
    for (const c of list) {
      if (now.getTime() - c.created * 1000 < LEFTOVER_AFTER_MS) continue;
      const at = home.get(c.id);
      if (at === node.id || (at !== undefined && c.state === "running")) continue;
      try {
        await agent.removeContainer(c.id, node);
        console.log(`removed leftover container of ${c.id} on ${node.id} (${at ? `server is on ${at}` : "no such server"})`);
        removed++;
      } catch (err) {
        console.error(`leftover container ${c.id} on ${node.id} not removed`, err);
      }
    }
  }
  return removed;
}

export async function runBillingJob(now = new Date()) {
  const result = { renewed: 0, suspended: 0, reminded: 0, warned: 0, deleted: 0, comeback: 0, startOffers: 0, abandoned: 0, provisioned: 0, leftovers: 0 };
  const onHost: ServerStatus[] = ["RUNNING", "STOPPED", "PROVISIONING"];

  // Auto-renewing servers whose period ends within a day: charge the saved card.
  result.renewed = await renewDueServers(now).catch((err) => {
    console.error("automatic renewals failed", err);
    return 0;
  });

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
  // Servers that renew by themselves are only told if the charge fails (renewal.ts).
  const ending = await db.server.findMany({
    where: {
      plan: { not: "FREE" },
      autoRenew: false,
      status: { in: onHost },
      paidUntil: { gt: now, lte: new Date(now.getTime() + REMIND_BEFORE_DAYS * DAY) },
    },
    include: OWNER,
  });
  for (const s of ending) {
    if (s.reminderSentFor?.getTime() === s.paidUntil!.getTime()) continue;
    // Its automatic renewal just failed: that email already said the same.
    if (s.renewTriedFor?.getTime() === s.paidUntil!.getTime()) continue;
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

  await trackPlayers(now, result);

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

  result.leftovers = await removeLeftoverContainers(now).catch((err) => {
    console.error("leftover containers not checked", err);
    return 0;
  });

  // Every server's disk limit and own domain, so the agents have them all.
  await syncDiskLimits().catch((err) => console.error("disk limits not sent", err));
  await syncPeerRoutes().catch((err) => console.error("peer routes not sent", err));
  await syncHostAliases().catch((err) => console.error("host aliases not sent", err));
  return result;
}
