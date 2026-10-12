// How long a paid plan can be bought for. Each period costs a share of the
// plan's 30-day price: a week a little more per day, longer periods less.

export const PERIODS = [
  { days: 7, share: 0.3, discount: 0 },
  { days: 30, share: 1, discount: 0 },
  { days: 60, share: 1.9, discount: 5 }, // 5% off two months
  { days: 90, share: 2.7, discount: 10 }, // 10% off three months
] as const;

export type PeriodDays = (typeof PERIODS)[number]["days"];
export const PERIOD_DAYS = PERIODS.map((p) => p.days);
export const DEFAULT_PERIOD: PeriodDays = 30;

/** What `days` of a plan costing `price` per 30 days comes to, rounded to the grosz/cent. */
export function periodPrice(price: number, days: PeriodDays) {
  const period = PERIODS.find((p) => p.days === days)!;
  return Math.round(price * period.share * 100) / 100;
}
