import type { Plan, Server } from "@prisma/client";
import type { Currency } from "@/i18n/config";
import { planById } from "./plans";

// Paid add-ons on top of a paid plan, each for a price per 30 days: more disk
// space, more backups kept, and the server's own domain (players type e.g.
// graj.mojserwer.pl instead of the mchosting.pl address; agent/aliases.go).
// They're paid for with the plan, for the same period: buying a plan or
// extending it pays for the add-ons the server has; one bought in the middle of
// a period costs its share of the time left (addonCost). Free servers have none.

export const ADDONS = ["disk", "backups", "domain"] as const;
export type AddonId = (typeof ADDONS)[number];

type AddonSpec = {
  diskGb: number; // on top of the plan's
  backups: number; // more daily backups kept
  // Price for 30 days, set per currency like the plans'.
  price: Record<Currency, number>;
};

export const ADDON_SPECS: Record<AddonId, AddonSpec> = {
  disk: { diskGb: 10, backups: 0, price: { PLN: 5, EUR: 1.2, USD: 1.3, GBP: 1 } },
  backups: { diskGb: 0, backups: 7, price: { PLN: 5, EUR: 1.2, USD: 1.3, GBP: 1 } },
  domain: { diskGb: 0, backups: 0, price: { PLN: 5, EUR: 1.2, USD: 1.3, GBP: 1 } },
};

export const isAddonId = (a: unknown): a is AddonId => ADDONS.includes(a as AddonId);

/** The known add-ons in a list, once each, in ADDONS order (e.g. from a form or the database). */
export function addonList(list: readonly string[] | null | undefined): AddonId[] {
  const set = new Set(list ?? []);
  return ADDONS.filter((a) => set.has(a));
}

/** Add-ons a server really has: none on the free plan. */
export const serverAddons = (s: Pick<Server, "plan" | "addons">) => (s.plan === "FREE" ? [] : addonList(s.addons));

/** What the add-ons cost per 30 days together. */
export function addonsMonthly(addons: readonly AddonId[], currency: Currency) {
  return Math.round(addons.reduce((sum, a) => sum + ADDON_SPECS[a].price[currency], 0) * 100) / 100;
}

/** Disk space in GB with the add-ons. */
export const diskGbFor = (s: Pick<Server, "plan" | "addons">) =>
  planById(s.plan).diskGb + serverAddons(s).reduce((gb, a) => gb + ADDON_SPECS[a].diskGb, 0);

/** Daily backups kept with the add-ons. */
export const backupsFor = (s: Pick<Server, "plan" | "addons">) =>
  planById(s.plan).backupsKept + serverAddons(s).reduce((n, a) => n + ADDON_SPECS[a].backups, 0);

/** Whether the server may use its own domain. */
export const hasOwnDomain = (s: Pick<Server, "plan" | "addons" | "edition">) => s.edition === "JAVA" && serverAddons(s).includes("domain");

const DAY = 24 * 60 * 60 * 1000;
// The smallest amount Stripe takes in each currency.
export const STRIPE_MINIMUM: Record<Currency, number> = { PLN: 2, EUR: 0.5, USD: 0.5, GBP: 0.3 };

/**
 * What adding `added` costs for the time left until `paidUntil`: their 30-day
 * price times the share of 30 days left, rounded up and never below what Stripe takes.
 */
export function addonCost(added: readonly AddonId[], paidUntil: Date, currency: Currency, now = new Date()) {
  const daysLeft = Math.max(0, paidUntil.getTime() - now.getTime()) / DAY;
  const exact = Math.ceil(((addonsMonthly(added, currency) * daysLeft) / 30) * 100 - 1e-6) / 100;
  return { amount: Math.max(exact, STRIPE_MINIMUM[currency]), daysLeft };
}

/** Whether add-ons can be bought now for the rest of the period (a paid server in a paid period). */
export function canBuyAddons(s: Pick<Server, "plan" | "paidUntil" | "status">, now = new Date()) {
  return s.plan !== "FREE" && !!s.paidUntil && s.paidUntil > now && s.status !== "SUSPENDED" && s.status !== "AWAITING_PAYMENT";
}

/** A plan's 30-day price with add-ons. */
export const monthlyWithAddons = (plan: Plan, addons: readonly AddonId[], currency: Currency) =>
  Math.round((planById(plan).price[currency] + (plan === "FREE" ? 0 : addonsMonthly(addons, currency))) * 100) / 100;
