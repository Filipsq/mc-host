"use client";

import { useState } from "react";
import type { Plan } from "@prisma/client";
import { format } from "@/i18n/messages";
import type { Currency } from "@/i18n/config";
import { formatPrice } from "@/lib/plans";
import { DEFAULT_PERIOD, PERIODS, periodPrice, type PeriodDays } from "@/lib/periods";
import type { AddonId } from "@/lib/addons";

export type PlanOption = { id: Plan; name: string; summary: string; monthly: number; disabledNote?: string };
export type AddonOption = { id: AddonId; name: string; hint: string; monthly: number };

type Props = {
  plans: PlanOption[];
  defaultPlan: Plan;
  periodLabels: { days: string; off: string }; // "{days} days", "−{n}%"
  labels: { plan: string; period: string; total: string };
  formatMoney: { locale: string; currency: string };
  onPlanChange?: (plan: Plan) => void;
  /** Paid add-ons ticked on top of a paid plan; submitted as `addons`, and counted in the total. */
  addons?: {
    options: AddonOption[];
    initial: AddonId[];
    labels: { title: string; hint: string; price: string }; // price: "+{price} / 30 days"
    onChange?: (ticked: AddonId[]) => void;
  };
};

/** Radio cards for plan + period, with a live total. Submits `plan` and `days`. */
export default function PlanPicker({ plans, defaultPlan, periodLabels, labels, formatMoney, onPlanChange, addons }: Props) {
  const [plan, setPlan] = useState<Plan>(defaultPlan);
  const [days, setDays] = useState<PeriodDays>(DEFAULT_PERIOD);
  const [ticked, setTicked] = useState<AddonId[]>(addons?.initial ?? []);
  const money = { format: (n: number) => formatPrice(n, formatMoney.currency as Currency, formatMoney.locale) };
  const selected = plans.find((p) => p.id === plan);
  const paid = plan !== "FREE";
  const extra = paid && addons ? addons.options.filter((o) => ticked.includes(o.id)).reduce((sum, o) => sum + o.monthly, 0) : 0;

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
      {paid && addons && addons.options.length > 0 && (
        <fieldset className="stack addon-picker">
          <legend>{addons.labels.title}</legend>
          <span className="muted small">{addons.labels.hint}</span>
          <div className="addon-options">
            {addons.options.map((o) => (
              <label key={o.id} className="choice addon-choice">
                <input
                  type="checkbox"
                  name="addons"
                  value={o.id}
                  checked={ticked.includes(o.id)}
                  onChange={(e) => {
                    const next = e.target.checked ? [...ticked, o.id] : ticked.filter((x) => x !== o.id);
                    setTicked(next);
                    addons.onChange?.(next);
                  }}
                />
                <span className="stack-tight">
                  <strong>{o.name}</strong>
                  <span className="addon-price">{format(addons.labels.price, { price: money.format(o.monthly) })}</span>
                  <span className="muted small">{o.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {paid && selected && (
        <p className="total">
          {labels.total}: <strong>{money.format(periodPrice(Math.round((selected.monthly + extra) * 100) / 100, days))}</strong>
        </p>
      )}
    </div>
  );
}
