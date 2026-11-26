"use client";

import { useActionState, useState } from "react";
import { format } from "@/i18n/messages";
import type { Plan } from "@prisma/client";
import { checkoutAction } from "../../actions";
import PlanPicker, { type PlanOption } from "@/components/PlanPicker";
import type { ComponentProps } from "react";
import PaymentConsent from "@/components/PaymentConsent";
import AdminTestBuy from "@/components/AdminTestBuy";
import PayBadges from "@/components/PayBadges";
import CashbillButton from "@/components/CashbillButton";
import type { Messages } from "@/i18n/messages";
import type { PeriodDays } from "@/lib/periods";

type Props = {
  serverId: string;
  plans: PlanOption[];
  defaultPlan: Plan;
  defaultDays?: PeriodDays;
  note?: string;
  t: Messages["billing"];
  labels: { plan: string; period: string };
  errors: Messages["server"]["errors"];
  legal: Messages["legal"];
  money: { locale: string; currency: string };
  addons: ComponentProps<typeof PlanPicker>["addons"];
  autoRenew: boolean; // ticked to start with (card payments only)
  cashbill: boolean; // BLIK and transfers through CashBill get their own button; cards go to Stripe (method=card)
  adminTest?: boolean; // an admin's test server: a free test purchase is offered too
  renewCode?: string | null; // a paid server: the renewal code field (renewCode.ts), filled in with this
  current?: Plan; // the plan of a server in a paid period: picking a smaller one is warned about, since paying changes the server to it
};

export default function CheckoutForm({ serverId, plans, defaultPlan, defaultDays, note, t, labels, errors, legal, money, autoRenew, addons, cashbill, adminTest, renewCode, current }: Props) {
  const [state, action, pending] = useActionState(checkoutAction.bind(null, serverId), {});
  const [plan, setPlan] = useState<Plan>(defaultPlan);
  // Plans come smallest first, so a lower index is a smaller plan.
  const rank = (id: Plan) => plans.findIndex((p) => p.id === id);
  const smaller = !!current && rank(plan) < rank(current);
  const name = (id: Plan) => plans.find((p) => p.id === id)?.name ?? id;
  return (
    <form action={action} className="card stack">
      <PlanPicker
        plans={plans}
        defaultPlan={defaultPlan}
        defaultDays={defaultDays}
        periodLabels={{ days: t.periodDays, off: t.periodOff }}
        labels={{ ...labels, total: t.total }}
        formatMoney={money}
        addons={addons}
        onPlanChange={setPlan}
      />
      {smaller && current && <p className="notice warn">{format(t.smallerPlan, { plan: name(plan), current: name(current) })}</p>}
      {note && <p className="muted small">{note}</p>}
      {renewCode !== null && renewCode !== undefined && (
        <label className="stack-tight">
          <span>{t.renewCode}</span>
          <input name="renewCode" defaultValue={renewCode} placeholder="ODNOW-XXXXXX" autoComplete="off" spellCheck={false} />
          <span className="muted small">{t.renewCodeHint}</span>
        </label>
      )}
      <label className="check">
        <input name="autoRenew" type="checkbox" defaultChecked={autoRenew} />
        <span className="stack-tight">
          <span>{t.autoRenew}</span>
          <span className="muted small">{t.autoRenewHint}</span>
        </span>
      </label>
      <p className="muted small">{cashbill ? t.methodsSplit : t.methods}</p>
      <PaymentConsent legal={legal} />
      {state.error && <p className="error">{errors[state.error]}</p>}
      <div className="pay-buttons">
        <button type="submit" className="pay-button" {...(cashbill && { name: "method", value: "card" })} disabled={pending}>
          <span className="pay-label">{pending ? t.redirecting : t.checkout}</span>
          <PayBadges method={cashbill ? "cards" : "main"} />
        </button>
        {cashbill && <CashbillButton t={t} disabled={pending} />}
      </div>
      <AdminTestBuy show={adminTest} pending={pending} t={t} />
    </form>
  );
}
