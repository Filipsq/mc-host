import type { Plan, Server } from "@prisma/client";
import type { Currency } from "@/i18n/config";
import { monthlyWithAddons, type AddonId } from "./addons";
import { periodPrice, type PeriodDays } from "./periods";

// On 2.11.2026 the prices went up so that, after 23% VAT, about the old amounts
// stay with us. Card renewals switched on before that keep the old price until
// Server.oldPriceUntil (set by the migration), giving the 14 days' notice the
// terms promise (§12); the billing job mails those owners once (notifyPriceChange).

/** 30-day prices before the change, per currency. */
const OLD_PLAN: Record<Exclude<Plan, "FREE">, Record<Currency, number>> = {
  STARTER: { PLN: 15, EUR: 3.5, USD: 4, GBP: 3 },
  STANDARD: { PLN: 29, EUR: 7, USD: 8, GBP: 6 },
  PRO: { PLN: 45, EUR: 10.5, USD: 12, GBP: 9 },
};
/** Each add-on's 30-day price before the change (all three cost the same). */
const OLD_ADDON: Record<Currency, number> = { PLN: 5, EUR: 1.2, USD: 1.3, GBP: 1 };

/** What `days` cost at the old prices. */
export function oldPriceFor(plan: Plan, days: PeriodDays, currency: Currency, addons: readonly AddonId[] = []) {
  if (plan === "FREE") return 0;
  const monthly = Math.round((OLD_PLAN[plan][currency] + addons.length * OLD_ADDON[currency]) * 100) / 100;
  return periodPrice(monthly, days);
}

/** Whether the server's next card renewal still charges the old price. */
export const keepsOldPrice = (s: Pick<Server, "oldPriceUntil">, now = new Date()) => !!s.oldPriceUntil && now < s.oldPriceUntil;

/** What the server's next card renewal charges. */
export function renewalPriceFor(
  s: Pick<Server, "oldPriceUntil">,
  plan: Plan,
  days: PeriodDays,
  currency: Currency,
  addons: readonly AddonId[],
  now = new Date(),
) {
  return keepsOldPrice(s, now) ? oldPriceFor(plan, days, currency, addons) : periodPrice(monthlyWithAddons(plan, addons, currency), days);
}
