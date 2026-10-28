"use client";

import { useActionState } from "react";
import type { Plan } from "@prisma/client";
import { checkoutAction } from "../../actions";
import PlanPicker, { type PlanOption } from "@/components/PlanPicker";
import type { ComponentProps } from "react";
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
  autoRenew: boolean; // ticked to start with
  addons: ComponentProps<typeof PlanPicker>["addons"];
  paysafecard: boolean; // offered too (hotpay.ts)
};

export default function CheckoutForm({ serverId, plans, defaultPlan, note, t, labels, errors, legal, money, autoRenew, addons, paysafecard }: Props) {
  const [state, action, pending] = useActionState(checkoutAction.bind(null, serverId), {});
  return (
    <form action={action} className="card stack">
      <PlanPicker
        plans={plans}
        defaultPlan={defaultPlan}
        periodLabels={{ days: t.periodDays, off: t.periodOff }}
        labels={{ ...labels, total: t.total }}
        formatMoney={money}
        addons={addons}
      />
      {note && <p className="muted small">{note}</p>}
      <label className="check">
        <input name="autoRenew" type="checkbox" defaultChecked={autoRenew} />
        <span className="stack-tight">
          <span>{t.autoRenew}</span>
          <span className="muted small">{t.autoRenewHint}</span>
        </span>
      </label>
      <p className="muted small">{t.methods}</p>
      <PaymentConsent legal={legal} />
      {state.error && <p className="error">{errors[state.error]}</p>}
      <button type="submit" disabled={pending}>{pending ? t.redirecting : t.checkout}</button>
      {paysafecard && (
        <>
          <button type="submit" className="secondary" name="method" value="paysafecard" disabled={pending}>
            {t.paysafecard}
          </button>
          <p className="muted small">{t.paysafecardHint}</p>
        </>
      )}
    </form>
  );
}
