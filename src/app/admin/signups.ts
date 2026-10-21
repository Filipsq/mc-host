const DAY = 24 * 60 * 60 * 1000;
const warsawDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" });

export type Bucket = { start: Date; count: number };

/**
 * New sign-ups per day, week (Monday to Sunday) and month, in Polish time, newest first.
 * Each bucket's start is midnight UTC of its first calendar day, so format it with timeZone "UTC".
 */
export function signupBuckets(joined: Date[], now: Date, sizes = { days: 14, weeks: 8, months: 12 }) {
  // The Polish calendar day as midnight UTC, so whole days can be counted with plain arithmetic.
  const day = (d: Date) => new Date(`${warsawDay.format(d)}T00:00:00Z`);
  const monday = (d: Date) => new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY);
  const month = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

  const today = day(now);
  const days = Array.from({ length: sizes.days }, (_, i) => new Date(today.getTime() - i * DAY));
  const weeks = Array.from({ length: sizes.weeks }, (_, i) => new Date(monday(today).getTime() - i * 7 * DAY));
  const months = Array.from({ length: sizes.months }, (_, i) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1)));

  const count = (starts: Date[], start: (d: Date) => Date): Bucket[] => {
    const n = new Map(starts.map((s) => [s.getTime(), 0]));
    for (const j of joined) {
      const key = start(day(j)).getTime();
      if (n.has(key)) n.set(key, n.get(key)! + 1);
    }
    return starts.map((s) => ({ start: s, count: n.get(s.getTime())! }));
  };
  return { days: count(days, (d) => d), weeks: count(weeks, monday), months: count(months, month) };
}

/** How far back signupBuckets looks, to load only the users it needs. */
export function signupsSince(now: Date) {
  return new Date(now.getTime() - 400 * DAY);
}
