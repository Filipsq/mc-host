"use client";

import { useState } from "react";
import type { Plan } from "@prisma/client";
import { format } from "@/i18n/messages";
import type { Currency } from "@/i18n/config";
import { formatPrice } from "@/lib/plans";
import { DEFAULT_PERIOD, PERIODS, periodPrice, type PeriodDays } from "@/lib/periods";

export type PlanOption = { id: Plan; name: string; summary: string; monthly: number; disabledNote?: string };

type Props = {
  plans: PlanOption[];
  defaultPlan: Plan;
  periodLabels: { days: string; off: string }; // "{days} days", "−{n}%"
  labels: { plan: string; period: string; total: string };
  formatMoney: { locale: string; currency: string };
  onPlanChange?: (plan: Plan) => void;
};

/** Radio cards for plan + period, with a live total. Submits `plan` and `days`. */
export default function PlanPicker({ plans, defaultPlan, periodLabels, labels, formatMoney, onPlanChange }: Props) {
  const [plan, setPlan] = useState<Plan>(defaultPlan);
  const [days, setDays] = useState<PeriodDays>(DEFAULT_PERIOD);
  const money = { format: (n: number) => formatPrice(n, formatMoney.currency as Currency, formatMoney.locale) };
  const selected = plans.find((p) => p.id === plan);
  const paid = plan !== "FREE";

  return (
    <div className="stack">
      <fieldset className="stack">
        <legend>{labels.plan}</legend>
        <div className="plan-options">
          {plans.map((p) => (
            <label key={p.id} className={`choice plan-choice${p.disabledNote ? " disabled" : ""}`}>
              <input
                type="radio"
                name="plan"
                value={p.id}
                checked={plan === p.id}
                disabled={!!p.disabledNote}
                onChange={() => {
                  setPlan(p.id);
                  onPlanChange?.(p.id);
                }}
              />
              <span className="stack-tight">
                <strong>{p.name}</strong>
                <span>{money.format(p.monthly)}</span>
                <span className="muted small">{p.disabledNote ?? p.summary}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {paid ? (
        <fieldset className="stack">
          <legend>{labels.period}</legend>
          <div className="row" style={{ justifyContent: "flex-start" }}>
            {PERIODS.map((p) => (
              <label key={p.days} className="choice">
                <input type="radio" name="days" value={p.days} checked={days === p.days} onChange={() => setDays(p.days)} />
                {format(periodLabels.days, { days: p.days })}
                {p.discount > 0 && <span className="off">{format(periodLabels.off, { n: p.discount })}</span>}
              </label>
            ))}
          </div>
        </fieldset>
      ) : (
        <input type="hidden" name="days" value={DEFAULT_PERIOD} />
      )}
      {paid && selected && (
        <p className="total">
          {labels.total}: <strong>{money.format(periodPrice(selected.monthly, days))}</strong>
        </p>
      )}
    </div>
  );
}
