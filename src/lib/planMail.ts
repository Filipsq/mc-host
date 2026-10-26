import "server-only";
import type { Server, User } from "@prisma/client";
import { messages, format } from "@/i18n/messages";
import { defaultLocale, isLocale, type Currency } from "@/i18n/config";
import { BRAND_NAME } from "./brand";
import { buttonMail, sendMail } from "./mail";
import { sendPush } from "./push";
import { formatPrice, planById } from "./plans";
import { periodPrice } from "./periods";

// Emails about a server's paid plan: when a payment arrives, a few days
// before the paid period ends (plans don't renew by themselves), when the
// server is suspended for it, and a few days before a suspended server is
// deleted; when its automatic renewal fails (renewal.ts). Also before a free server nobody plays on is deleted.

export type PlanMailKind = "paid" | "reminder" | "suspended" | "deletion" | "inactive" | "renewFailed";
export type ServerWithOwner = Server & { owner: Pick<User, "email" | "locale"> };

/** How long before the end of a paid period its owner is reminded. */
export const REMIND_BEFORE_DAYS = 3;
/** How long the terms promise to keep a suspended server's world. */
export const KEEP_DAYS = 14;
/** How long before deleting a suspended server its owner is told. */
export const WARN_BEFORE_DELETE_DAYS = 3;
/** After how many days with nobody playing a free server is deleted (the terms say so too). */
export const FREE_IDLE_DAYS = 7;
/** How long before that its owner is told. */
export const WARN_BEFORE_IDLE_DELETE_DAYS = 2;
/** The terms that allow it take effect then (14 days' notice, §12); nothing is deleted for being idle before. */
export const FREE_IDLE_FROM = new Date("2026-11-01T00:00:00+01:00");

/** Emails the server's owner, in their language. Reports whether it went out; never throws. */
export async function sendPlanMail(kind: PlanMailKind, server: ServerWithOwner, deleteOn?: Date): Promise<boolean> {
  const locale = isLocale(server.owner.locale) ? server.owner.locale : defaultLocale;
  const all = messages[locale];
  const t = all.planMail[kind];
  const app = process.env.APP_URL ?? "http://localhost:3000";
  // Polish time: that's where the servers and players are.
  const when = (d: Date) =>
    `${d.toLocaleDateString(locale, { dateStyle: "long", timeZone: "Europe/Warsaw" })}, ${d.toLocaleTimeString(locale, { timeStyle: "short", timeZone: "Europe/Warsaw" })}`;
  const vars = {
    server: server.name,
    plan: all.plans[server.plan],
    date: server.paidUntil ? when(server.paidUntil) : "",
    days: KEEP_DAYS,
    idleDays: FREE_IDLE_DAYS - WARN_BEFORE_IDLE_DELETE_DAYS,
    deleteOn: deleteOn ? when(deleteOn) : "",
    // A free server about to go is offered the cheapest way to keep it: a week of Starter.
    starter: starterWeekPrice(locale === "pl" ? "PLN" : "EUR", locale),
  };
  const page = `${app}/dashboard/servers/${server.id}${kind === "paid" ? "" : "/billing"}`;
  const mail = buttonMail({
    to: server.owner.email,
    subject: format(t.subject, vars),
    // A server that renews by itself says so instead of "it won't renew".
    paragraphs: (kind === "paid" && server.autoRenew ? [t.paragraphs[0], all.planMail.paidAutoRenew] : t.paragraphs).map((p) =>
      format(p, { ...vars, card: server.renewCardLabel ?? "" }),
    ),
    button: t.button,
    url: page,
    footer: format(all.planMail.footer, { brand: BRAND_NAME, contact: `${app}/kontakt` }),
  });
  // The phone notification says the same in short; the email stays the full record.
  await sendPush([server.ownerId], { title: mail.subject, body: format(t.paragraphs[0], vars), url: page });
  try {
    await sendMail(mail);
    return true;
  } catch (err) {
    console.error(`[mail] ${kind} email for server ${server.id} failed:`, err);
    return false;
  }
}

/** What a week of Starter costs, written out, e.g. "4,50 zł". */
export function starterWeekPrice(currency: Currency, locale: string) {
  return formatPrice(periodPrice(planById("STARTER").price[currency], 7), currency, locale);
}
