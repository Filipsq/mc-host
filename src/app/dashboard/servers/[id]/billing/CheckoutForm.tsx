"use client";

import { useActionState } from "react";
import type { Plan } from "@prisma/client";
import { checkoutAction } from "../../actions";
import PlanPicker, { type PlanOption } from "@/components/PlanPicker";
import type { ComponentProps } from "react";
import PaymentConsent from "@/components/PaymentConsent";
import PayBadges from "@/components/PayBadges";
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
  paysafecard: boolean; // offered too (cashbill.ts)
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
      <p className="muted small">{paysafecard ? t.methodsCashbill : t.methods}</p>
      {paysafecard && <p className="muted small">{t.paysafecardHint}</p>}
      <PaymentConsent legal={legal} />
      {state.error && <p className="error">{errors[state.error]}</p>}
      <div className="pay-buttons">
        <button type="submit" className="pay-button" disabled={pending}>
          <span className="pay-label">{pending ? t.redirecting : t.checkout}</span>
          <PayBadges method={paysafecard ? "cards" : "stripe"} />
        </button>
        {paysafecard && (
          <button type="submit" className="secondary pay-button" name="method" value="paysafecard" disabled={pending}>
            <span className="pay-label">{t.paysafecard}</span>
            <PayBadges method="cashbill" />
          </button>
        )}
      </div>
    </form>
  );
}
