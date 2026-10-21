import type { Plan, Server } from "@prisma/client";
import type { Currency } from "@/i18n/config";
import { planById, plans } from "./plans";

// Moving to a bigger plan in the middle of a paid period: the period keeps its
// end date and the owner pays only the price difference for the time left.

const DAY = 24 * 60 * 60 * 1000;

// The smallest amount Stripe takes in each currency.
const STRIPE_MINIMUM: Record<Currency, number> = { PLN: 2, EUR: 0.5, USD: 0.5, GBP: 0.3 };

const rank = (plan: Plan) => plans.findIndex((p) => p.id === plan);

/** Plans bigger than `plan`, smallest first. */
export function biggerPlans(plan: Plan) {
  return plans.filter((p) => rank(p.id) > rank(plan));
}

/** Whether the server is in a paid period that can be upgraded (not free, not expired). */
export function canUpgrade(server: Pick<Server, "plan" | "paidUntil" | "status">, now = new Date()) {
  return (
    server.plan !== "FREE" &&
    !!server.paidUntil &&
    server.paidUntil > now &&
    server.status !== "SUSPENDED" &&
    server.status !== "AWAITING_PAYMENT" &&
    biggerPlans(server.plan).length > 0
  );
}

/**
 * What moving from `from` to `to` costs for the time left until `paidUntil`:
 * the 30-day price difference times the share of 30 days left, rounded up to
 * the grosz/cent and never below what Stripe can take.
 */
export function upgradeCost(from: Plan, to: Plan, paidUntil: Date, currency: Currency, now = new Date()) {
  const msLeft = Math.max(0, paidUntil.getTime() - now.getTime());
  const daysLeft = msLeft / DAY;
  const difference = planById(to).price[currency] - planById(from).price[currency];
  const exact = Math.ceil(((difference * daysLeft) / 30) * 100 - 1e-6) / 100;
  const minimum = STRIPE_MINIMUM[currency];
  return { amount: Math.max(exact, minimum), atMinimum: exact < minimum, daysLeft };
}
