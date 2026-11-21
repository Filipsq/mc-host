// When we pay for our machines, and what each costs a month, for the admin overview's "Koszty" part.
// Machines are bought on different days, so the page doesn't line payments up with sales: it compares
// what the machines cost per 30 days with what customers paid in the last 30 days (both roll every day),
// and lists the coming machine payments on their own so there's money on the account when they're due.

const DAY = 24 * 60 * 60 * 1000;
export const COST_VAT = 0.23;
export const PAYMENT_PERIODS = [1, 3, 6, 12] as const;

/** Today in Polish time, as a date at UTC midnight (the way Postgres DATE columns come back). */
export function warsawToday(now: Date): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(now);
  return new Date(`${ymd}T00:00:00Z`);
}

/** The date `months` months after `from`, on the same day, or the month's last day when it's shorter (31 Jan → 28 Feb). */
export function addMonths(from: Date, months: number): Date {
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(from.getUTCDate(), last)));
}

/** The next payment on or after today: a date typed in the past moves on by whole periods, counted from the typed day. */
export function nextPaymentOn(typed: Date, periodMonths: number, today: Date): Date {
  const period = Math.max(1, periodMonths);
  let k = 0;
  let next = typed;
  while (next < today && k < 1200) next = addMonths(typed, ++k * period);
  return next;
}

/** Whole days from today to that date (0 = today). */
export function daysUntil(date: Date, today: Date): number {
  return Math.round((date.getTime() - today.getTime()) / DAY);
}

/** One payment without VAT, in minor units of its currency. */
export function netAmount(cost: { amount: number; gross: boolean }): number {
  return cost.gross ? Math.round(cost.amount / (1 + COST_VAT)) : cost.amount;
}

/** What the machine costs per month without VAT, in minor units of its currency. */
export function monthlyNet(cost: { amount: number; gross: boolean; periodMonths: number }): number {
  return Math.round(netAmount(cost) / Math.max(1, cost.periodMonths));
}

/** Reads a date typed as YYYY-MM-DD (what <input type="date"> sends); anything else is null. */
export function parseDay(raw: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== raw ? null : d;
}
