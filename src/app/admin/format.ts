import "server-only";
import type { Currency } from "@/i18n/config";
import { formatPrice } from "@/lib/plans";

export type Formats = ReturnType<typeof formats>;

/** Dates, sizes and money as the admin panel shows them, in Polish time. */
export function formats(locale: string) {
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Europe/Warsaw" });
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Warsaw" });
  const decimal = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const money = (minor: number, currency: string) => formatPrice(minor / 100, currency as Currency, locale);
  return {
    date: (d: Date) => date.format(d),
    dateTime: (d: Date) => dateTime.format(d),
    number: (n: number) => decimal.format(n),
    gb: (mb: number) => `${decimal.format(mb / 1024)} GB`,
    money,
    /** Amounts in several currencies, each added up on its own, e.g. "120 zł + 8 €". */
    totals(rows: { amount: number; currency: string }[]) {
      const sums = new Map<string, number>();
      for (const r of rows) sums.set(r.currency, (sums.get(r.currency) ?? 0) + r.amount);
      return [...sums].map(([currency, amount]) => money(amount, currency)).join(" + ");
    },
  };
}
