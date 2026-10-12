import "server-only";
import type { Plan } from "@prisma/client";
import type { Currency } from "@/i18n/config";
import { format, type Messages } from "@/i18n/messages";
import { plans } from "./plans";
import type { PlanOption } from "@/components/PlanPicker";

/** Plan cards for the PlanPicker, translated and priced in the visitor's currency. */
export function planOptions(t: Messages, currency: Currency, include: (id: Plan) => boolean = () => true): PlanOption[] {
  return plans
    .filter((p) => include(p.id))
    .map((p) => ({
      id: p.id,
      name: t.plans[p.id],
      monthly: p.price[currency],
      summary: [
        format(t.plans.ram, { gb: p.ramGb }),
        format(t.plans.disk, { gb: p.diskGb }),
        p.maxPlayers === null ? t.plans.unlimitedPlayers : format(t.plans.players, { n: p.maxPlayers }),
        p.alwaysOn ? t.plans.alwaysOn : t.plans.sleeps,
      ].join(" · "),
    }));
}
