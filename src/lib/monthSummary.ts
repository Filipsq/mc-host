// "Podsumowanie miesiąca": the month a server had, as a card owners save and share.

/** "2026-11" for the month a date falls in, in Polish time (as the agent counts). */
export function monthOf(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit" }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("year")}-${get("month")}`;
}

export function previousMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export const isMonth = (s: string | undefined): s is string => !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

/** "listopad 2026" */
export function monthName(month: string, locale: string) {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(Date.UTC(y, m - 1, 15));
}

/** "14 listopada" */
export function dayName(day: string, locale: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "UTC" }).format(Date.UTC(y, m - 1, d));
}

/** Hours, whole above 10, one decimal below: "128", "2,5". */
export function hours(minutes: number, locale: string) {
  const h = minutes / 60;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: h >= 10 ? 0 : 1 }).format(h);
}
