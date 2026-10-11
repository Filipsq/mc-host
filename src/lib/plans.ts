import type { Plan } from "@prisma/client";
import type { Currency } from "@/i18n/config";

type PlanSpec = {
  id: Plan;
  ramGb: number;
  cpus: number;
  maxPlayers: number | null; // null = unlimited
  alwaysOn: boolean;
  backupsKept: number;
  // Monthly price set per currency (not converted), matching what Stripe will charge.
  price: Record<Currency, number>;
};

export const plans: PlanSpec[] = [
  { id: "FREE", cpus: 1, ramGb: 2, maxPlayers: 10, alwaysOn: false, backupsKept: 0, price: { PLN: 0, EUR: 0, USD: 0, GBP: 0 } },
  { id: "STARTER", cpus: 2, ramGb: 3, maxPlayers: 20, alwaysOn: true, backupsKept: 1, price: { PLN: 15, EUR: 4, USD: 4, GBP: 3 } },
  { id: "STANDARD", cpus: 3, ramGb: 6, maxPlayers: 40, alwaysOn: true, backupsKept: 7, price: { PLN: 35, EUR: 9, USD: 10, GBP: 8 } },
  { id: "PRO", cpus: 4, ramGb: 10, maxPlayers: null, alwaysOn: true, backupsKept: 14, price: { PLN: 59, EUR: 15, USD: 16, GBP: 13 } },
];

export const planById = (id: Plan) => plans.find((p) => p.id === id)!;

export function formatPrice(amount: number, currency: Currency, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}
