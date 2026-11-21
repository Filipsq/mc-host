"use client";

import { useActionState } from "react";
import type { Plan } from "@prisma/client";
import { checkoutAction } from "../../actions";
import PlanPicker, { type PlanOption } from "@/components/PlanPicker";
import type { ComponentProps } from "react";
import PaymentConsent from "@/components/PaymentConsent";
import AdminTestBuy from "@/components/AdminTestBuy";
import PayBadges from "@/components/PayBadges";
import PaysafecardButton from "@/components/PaysafecardButton";
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
  addons: ComponentProps<typeof PlanPicker>["addons"];
  adminTest?: boolean; // an admin's test server: a free test purchase is offered too
  renewCode?: string | null; // a paid server: the renewal code field (renewCode.ts), filled in with this
};

export default function CheckoutForm({ serverId, plans, defaultPlan, note, t, labels, errors, legal, money, addons, adminTest, renewCode }: Props) {
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
      {renewCode !== null && renewCode !== undefined && (
        <label className="stack-tight">
          <span>{t.renewCode}</span>
          <input name="renewCode" defaultValue={renewCode} placeholder="ODNOW-XXXXXX" autoComplete="off" spellCheck={false} />
          <span className="muted small">{t.renewCodeHint}</span>
        </label>
      )}
      <p className="muted small">{t.methods}</p>
      <PaymentConsent legal={legal} />
      {state.error && <p className="error">{errors[state.error]}</p>}
      <div className="pay-buttons">
        <button type="submit" className="pay-button" disabled={pending}>
          <span className="pay-label">{pending ? t.redirecting : t.checkout}</span>
          <PayBadges />
        </button>
        <PaysafecardButton t={t} what={t.paysafecardFor.renew} disabled={pending} />
      </div>
      <AdminTestBuy show={adminTest} pending={pending} t={t} />
    </form>
  );
}
