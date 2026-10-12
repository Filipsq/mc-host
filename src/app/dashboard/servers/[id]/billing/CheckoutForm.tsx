"use client";

import { useActionState } from "react";
import type { Plan } from "@prisma/client";
import { checkoutAction } from "../../actions";
import PlanPicker, { type PlanOption } from "@/components/PlanPicker";
import PaymentConsent from "@/components/PaymentConsent";
import type { Messages } from "@/i18n/messages";

type Props = {
  serverId: string;
  plans: PlanOption[];
  defaultPlan: Plan;
  note?: string;
  t: Messages["billing"];
  labels: { plan: string; period: string };
  errors: Messages["server"]["errors"];
  legal: Messages["legal"];
  money: { locale: string; currency: string };
};

export default function CheckoutForm({ serverId, plans, defaultPlan, note, t, labels, errors, legal, money }: Props) {
  const [state, action, pending] = useActionState(checkoutAction.bind(null, serverId), {});
  return (
    <form action={action} className="card stack">
      <PlanPicker
        plans={plans}
        defaultPlan={defaultPlan}
        periodLabels={{ 1: t.months1, 3: t.months3 }}
        labels={{ ...labels, total: t.total }}
        formatMoney={money}
      />
      {note && <p className="muted small">{note}</p>}
      <p className="muted small">{t.methods}</p>
      <PaymentConsent legal={legal} />
      {state.error && <p className="error">{errors[state.error]}</p>}
      <button type="submit" disabled={pending}>{pending ? t.redirecting : t.checkout}</button>
    </form>
  );
}
