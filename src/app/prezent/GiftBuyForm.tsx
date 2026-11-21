"use client";

import { useActionState } from "react";
import type { Plan } from "@prisma/client";
import PlanPicker, { type PlanOption } from "@/components/PlanPicker";
import LinkedText from "@/components/legal/LinkedText";
import PayBadges from "@/components/PayBadges";
import PaysafecardButton from "@/components/PaysafecardButton";
import type { Messages } from "@/i18n/messages";
import { buyGiftAction } from "./actions";

type Props = {
  plans: PlanOption[];
  defaultPlan: Plan;
  t: Messages["gifts"];
  billing: Messages["billing"];
  legal: Messages["legal"];
  labels: { plan: string; period: string };
  validity: string;
  money: { locale: string; currency: string };
};

export default function GiftBuyForm({ plans, defaultPlan, t, billing, legal, labels, validity, money }: Props) {
  const [state, action, pending] = useActionState(buyGiftAction, {});
  return (
    <form action={action} className="card stack">
      <h2>{t.buyTitle}</h2>
      <PlanPicker
        plans={plans}
        defaultPlan={defaultPlan}
        periodLabels={{ days: billing.periodDays, off: billing.periodOff }}
        labels={{ ...labels, total: billing.total }}
        formatMoney={money}
      />
      <p className="muted small">{validity}</p>
      <p className="muted small">{t.methods}</p>
      <label className="check">
        <input name="consent" type="checkbox" required />
        <span>{t.consent}</span>
      </label>
      <p className="muted small">
        <LinkedText text={legal.payTerms} href="/regulamin" label={legal.termsLinkGenitive} newTab />
      </p>
      {state.error && <p className="error">{t.errors[state.error]}</p>}
      <div className="pay-buttons">
        <button type="submit" className="pay-button" disabled={pending}>
          <span className="pay-label">{pending ? t.redirecting : t.buy}</span>
          <PayBadges />
        </button>
        <PaysafecardButton t={billing} what={billing.paysafecardFor.gift} disabled={pending} />
      </div>
    </form>
  );
}
