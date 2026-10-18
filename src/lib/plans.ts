import type { Plan } from "@prisma/client";
import type { Currency } from "@/i18n/config";

type PlanSpec = {
  id: Plan;
  ramGb: number;
  diskGb: number; // for the world and the server's files; backups don't count
  cpus: number;
  maxPlayers: number | null; // null = unlimited
  alwaysOn: boolean;
  backupsKept: number;
  // Price for 30 days, set per currency (not converted); other periods follow from it (periods.ts).
  price: Record<Currency, number>;
};

export const plans: PlanSpec[] = [
  { id: "FREE", cpus: 1, ramGb: 2, diskGb: 2, maxPlayers: 10, alwaysOn: false, backupsKept: 0, price: { PLN: 0, EUR: 0, USD: 0, GBP: 0 } },
  { id: "STARTER", cpus: 2, ramGb: 3, diskGb: 10, maxPlayers: 20, alwaysOn: true, backupsKept: 1, price: { PLN: 15, EUR: 3.5, USD: 4, GBP: 3 } },
  { id: "STANDARD", cpus: 3, ramGb: 6, diskGb: 20, maxPlayers: 40, alwaysOn: true, backupsKept: 7, price: { PLN: 29, EUR: 7, USD: 8, GBP: 6 } },
  { id: "PRO", cpus: 4, ramGb: 10, diskGb: 40, maxPlayers: null, alwaysOn: true, backupsKept: 14, price: { PLN: 45, EUR: 10.5, USD: 12, GBP: 9 } },
];

export const planById = (id: Plan) => plans.find((p) => p.id === id)!;

export function formatPrice(amount: number, currency: Currency, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}
