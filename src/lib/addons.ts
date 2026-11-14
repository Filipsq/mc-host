import type { Plan, Server } from "@prisma/client";
import type { Currency } from "@/i18n/config";
import { planById } from "./plans";

// Paid add-ons on top of a paid plan, each for a price per 30 days: more disk
// space, more backups kept, the server's own domain (players type e.g.
// graj.mojserwer.pl instead of the mchosting.pl address; agent/aliases.go), and
// console joining (xbox.ts; a free server buys that one on its own, dearer).
// They're paid for with the plan, for the same period: buying a plan or
// extending it pays for the add-ons the server has; one bought in the middle of
// a period costs its share of the time left (addonCost). Free servers have none.

export const ADDONS = ["disk", "backups", "domain", "xbox"] as const;
export type AddonId = (typeof ADDONS)[number];

type AddonSpec = {
  diskGb: number; // on top of the plan's
  backups: number; // more daily backups kept
  // Price for 30 days, set per currency like the plans'.
  price: Record<Currency, number>;
};

export const ADDON_SPECS: Record<AddonId, AddonSpec> = {
  disk: { diskGb: 10, backups: 0, price: { PLN: 5, EUR: 1.5, USD: 1.6, GBP: 1.3 } },
  backups: { diskGb: 0, backups: 7, price: { PLN: 5, EUR: 1.5, USD: 1.6, GBP: 1.3 } },
  domain: { diskGb: 0, backups: 0, price: { PLN: 5, EUR: 1.5, USD: 1.6, GBP: 1.3 } },
  xbox: { diskGb: 0, backups: 0, price: { PLN: 5, EUR: 1.5, USD: 1.6, GBP: 1.3 } },
};

/**
 * Whether an add-on means anything for a game: the own domain is for Java
 * addresses only (players of other games join by IP and port), console joining
 * for Minecraft (Bedrock, or Java with crossplay).
 */
export function addonFits(id: AddonId, edition: string) {
  if (id === "domain") return edition === "JAVA";
  if (id === "xbox") return edition === "JAVA" || edition === "BEDROCK";
  return true;
}

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

const DAY = 24 * 60 * 60 * 1000;

// A free Java server buys its own domain on its own, DOMAIN_DAYS at a time, at the add-on's price (Fiq, 2026-11-14).
export const DOMAIN_DAYS = 30;

/** Whether a free server's bought days of its own domain are still running. */
export const domainPaidFor = (s: Pick<Server, "domainUntil">, now = new Date()) => !!s.domainUntil && s.domainUntil > now;

/** Where the bought days end once `days` more are paid for, counting from what's left. */
export function domainUntilAfter(s: Pick<Server, "domainUntil">, days: number, now = new Date()) {
  const from = domainPaidFor(s, now) ? s.domainUntil! : now;
  return new Date(from.getTime() + days * DAY);
}

/** Whether the server may use its own domain: the add-on on a paid plan, or bought days (kept after moving to a paid plan). */
export const hasOwnDomain = (s: Pick<Server, "plan" | "addons" | "edition" | "domainUntil">, now = new Date()) =>
  s.edition === "JAVA" && (serverAddons(s).includes("domain") || domainPaidFor(s, now));

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
