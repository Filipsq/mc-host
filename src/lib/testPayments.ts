import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { BRAND_NAME } from "./brand";
import { buttonMail, sendMail } from "./mail";
import { sendPush } from "./push";
import { TEST_PAYMENTS, provision } from "./billing";
import { messages, format } from "@/i18n/messages";
import { defaultLocale, isLocale } from "@/i18n/config";

// The site took its first payments with Stripe test keys, which move no money:
// a customer could finish a checkout (the BLIK and Przelewy24 test pages have
// a button that approves the payment) and their server got its plan anyway,
// and real cards were turned down. The admin panel lists these customers, and
// with one click per customer (or for all) the site tells them by email, phone
// notification and a notice in the panel, and makes up for it: a server that
// got its plan this way runs free for APOLOGY_DAYS from then on, and the next
// payment's period starts after them; a customer whose payment didn't go
// through gets APOLOGY_DAYS added to their first paid period.

export const APOLOGY_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;

const LIVE_PAID = {
  status: "PAID",
  // paysafecard payments (hotpay.ts) are always real.
  OR: [{ stripeSessionId: { startsWith: "cs_live_" } }, { hotpayId: { not: null } }],
} satisfies Prisma.PaymentWhereInput;
// Customers: not the admins' own tests, nor test accounts.
const CUSTOMER = { admin: false, NOT: { email: { endsWith: "@example.com" } } } satisfies Prisma.UserWhereInput;
// A server on a paid plan with no real payment behind it: every paid plan so far came from test checkouts.
export const TEST_PLAN = {
  plan: { not: "FREE" },
  status: { not: "AWAITING_PAYMENT" },
  payments: { none: LIVE_PAID },
} satisfies Prisma.ServerWhereInput;

const SERVER_FIELDS = { id: true, name: true, plan: true, paidUntil: true, status: true } as const;

/** Customers who haven't been told yet: their servers with a plan from a test payment, or none if their payment just failed. */
export async function untoldCustomers() {
  return db.user.findMany({
    where: {
      ...CUSTOMER,
      paymentNoticeAt: null,
      payments: { none: LIVE_PAID },
      OR: [{ servers: { some: TEST_PLAN } }, { payments: { some: TEST_PAYMENTS } }],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, servers: { where: TEST_PLAN, select: SERVER_FIELDS } },
  });
}

/** Customers already told, newest first, and whether they have paid for real since. */
export async function toldCustomers() {
  const users = await db.user.findMany({
    where: { paymentNoticeAt: { not: null } },
    orderBy: { paymentNoticeAt: "desc" },
    select: { id: true, email: true, paymentNoticeAt: true, apologyDays: true, _count: { select: { payments: { where: LIVE_PAID } } } },
  });
  return users.map(({ _count, ...u }) => ({ ...u, paidSince: _count.payments > 0 }));
}

/** What the panel tells a customer who was told and hasn't paid for real yet, or null. */
export async function paymentNotice(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      paymentNoticeAt: true,
      apologyDays: true,
      servers: { where: TEST_PLAN, select: SERVER_FIELDS, orderBy: { paidUntil: "asc" } },
      _count: { select: { payments: { where: LIVE_PAID } } },
    },
  });
  if (!user?.paymentNoticeAt || user._count.payments > 0) return null;
  return { apologyDays: user.apologyDays, servers: user.servers };
}

/**
 * Tells one customer and makes up for it (see the top of this file). Does
 * nothing for someone told before, an admin, or a customer who has paid for
 * real; returns whether it told them.
 */
export async function makeUpForTestPayment(userId: string, now = new Date()): Promise<boolean> {
  const until = new Date(now.getTime() + APOLOGY_DAYS * DAY);
  const done = await db.$transaction(async (tx) => {
    const claimed = await tx.user.updateMany({
      where: { id: userId, ...CUSTOMER, paymentNoticeAt: null, payments: { none: LIVE_PAID } },
      data: { paymentNoticeAt: now },
    });
    if (claimed.count === 0) return null;
    const servers = await tx.server.findMany({ where: { ownerId: userId, ...TEST_PLAN } });
    for (const s of servers) {
      await tx.server.update({
        where: { id: s.id },
        data: {
          paidUntil: until,
          deletionWarnedAt: null,
          // A server whose test period already ran out starts again.
          ...(s.status === "SUSPENDED" && { status: "PROVISIONING" }),
        },
      });
    }
    const user = await tx.user.update({
      where: { id: userId },
      data: servers.length ? {} : { apologyDays: APOLOGY_DAYS },
      select: { id: true, email: true, locale: true },
    });
    return { user, servers: servers.map((s) => ({ ...s, paidUntil: until, status: s.status === "SUSPENDED" ? "PROVISIONING" : s.status })) };
  });
  if (!done) return false;
  console.info("told about a test payment", userId, done.servers.length ? `${done.servers.length} servers free until ${until.toISOString()}` : `${APOLOGY_DAYS} days on the first payment`);

  for (const s of done.servers) if (s.status === "PROVISIONING") await provision(s);
  await sendApology(done.user, done.servers, until);
  return true;
}

async function sendApology(user: { id: string; email: string; locale: string }, servers: { id: string; name: string }[], until: Date) {
  const locale = isLocale(user.locale) ? user.locale : defaultLocale;
  const all = messages[locale];
  const t = servers.length ? all.testPaymentMail.server : all.testPaymentMail.retry;
  const app = process.env.APP_URL ?? "http://localhost:3000";
  const date = `${until.toLocaleDateString(locale, { dateStyle: "long", timeZone: "Europe/Warsaw" })}, ${until.toLocaleTimeString(locale, { timeStyle: "short", timeZone: "Europe/Warsaw" })}`;
  const vars = { server: servers.map((s) => s.name).join(", "), date, days: APOLOGY_DAYS, brand: BRAND_NAME };
  const page = servers.length === 1 ? `${app}/dashboard/servers/${servers[0].id}/billing` : `${app}/dashboard`;
  const mail = buttonMail({
    to: user.email,
    subject: format(t.subject, vars),
    paragraphs: t.paragraphs.map((p) => format(p, vars)),
    button: t.button,
    url: page,
    footer: format(all.planMail.footer, { brand: BRAND_NAME, contact: `${app}/kontakt` }),
  });
  await sendPush([user.id], { title: mail.subject, body: format(t.paragraphs[0], vars), url: page });
  try {
    await sendMail(mail);
  } catch (err) {
    console.error(`[mail] test payment apology for user ${user.id} failed:`, err);
  }
}
