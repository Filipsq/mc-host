import "server-only";
import type { Currency } from "@/i18n/config";
import { formatPrice } from "@/lib/plans";
import { formatMb } from "@/lib/disk";

export type Formats = ReturnType<typeof formats>;

/** Dates, sizes and money as the admin panel shows them, in Polish time. */
export function formats(locale: string) {
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Europe/Warsaw" });
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Warsaw" });
  const time = new Intl.DateTimeFormat(locale, { timeStyle: "short", timeZone: "Europe/Warsaw" });
  const decimal = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const money = (minor: number, currency: string) => formatPrice(minor / 100, currency as Currency, locale);
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  return {
    locale,
    date: (d: Date) => date.format(d),
    dateTime: (d: Date) => dateTime.format(d),
    time: (d: Date) => time.format(d),
    number: (n: number) => decimal.format(n),
    gb: (mb: number) => `${decimal.format(mb / 1024)} GB`,
    size: (mb: number) => formatMb(mb, locale),
    money,
    /** How long ago, e.g. "5 minut temu", "3 dni temu". */
    ago(d: Date, now = Date.now()) {
      const minutes = Math.max(0, Math.round((now - d.getTime()) / 60_000));
      if (minutes < 60) return relative.format(-minutes, "minute");
      if (minutes < 48 * 60) return relative.format(-Math.round(minutes / 60), "hour");
      return relative.format(-Math.round(minutes / (24 * 60)), "day");
    },
    /** Amounts in several currencies, each added up on its own, e.g. "120 zł + 8 €". */
    totals(rows: { amount: number; currency: string }[]) {
      const sums = new Map<string, number>();
      for (const r of rows) sums.set(r.currency, (sums.get(r.currency) ?? 0) + r.amount);
      return [...sums].map(([currency, amount]) => money(amount, currency)).join(" + ");
    },
  };
}
