"use client";

import { useActionState, useState } from "react";
import type { Plan } from "@prisma/client";
import { ArrowRight, Info } from "lucide-react";
import { upgradeAction } from "../../actions";
import PaymentConsent from "@/components/PaymentConsent";
import type { Messages } from "@/i18n/messages";

export type UpgradeOption = {
  id: Plan;
  name: string;
  ramGb: number;
  diskGb: number;
  cpus: number;
  maxPlayers: number | null;
  backupsKept: number;
  specs: string; // "6 GB RAM · 20 GB na dysku · Do 40 graczy"
  monthly: string; // "29 zł / 30 dni"
  bigger: boolean;
  cost: { amount: string; atMinimum: boolean } | null; // only for bigger plans
};

type Props = {
  serverId: string;
  current: Plan;
  plans: UpgradeOption[];
  costHint: string;
  moveNote: string;
  t: Messages["upgrade"];
  billing: Messages["billing"];
  legal: Messages["legal"];
  errors: Messages["server"]["errors"];
};

/** The plan list, what changes, and what it costs now; submits `plan`. */
export default function UpgradeForm({ serverId, current, plans, costHint, moveNote, t, billing, legal, errors }: Props) {
  const [state, action, pending] = useActionState(upgradeAction.bind(null, serverId), {});
  const [plan, setPlan] = useState<Plan>(plans.find((p) => p.bigger)!.id);
  const from = plans.find((p) => p.id === current)!;
  const to = plans.find((p) => p.id === plan)!;
  const players = (n: number | null) => (n === null ? t.unlimited : String(n));
  const changes = [
    { label: t.rows.ram, from: `${from.ramGb} GB`, to: `${to.ramGb} GB`, diff: `+${to.ramGb - from.ramGb} GB` },
    { label: t.rows.disk, from: `${from.diskGb} GB`, to: `${to.diskGb} GB`, diff: `+${to.diskGb - from.diskGb} GB` },
    {
      label: t.rows.players,
      from: players(from.maxPlayers),
      to: players(to.maxPlayers),
      diff: from.maxPlayers !== null && to.maxPlayers !== null ? `+${to.maxPlayers - from.maxPlayers}` : null,
    },
    { label: t.rows.cpus, from: String(from.cpus), to: String(to.cpus), diff: to.cpus > from.cpus ? `+${to.cpus - from.cpus}` : null },
    { label: t.rows.backups, from: String(from.backupsKept), to: String(to.backupsKept), diff: `+${to.backupsKept - from.backupsKept}` },
  ];

  return (
    <form action={action} className="stack">
      <fieldset className="card stack">
        <legend className="card-title">{t.choose}</legend>
        <div className="upgrade-plans">
          {plans.map((p) => (
            <label key={p.id} className={`choice upgrade-plan${p.bigger ? "" : " disabled"}`}>
              <input type="radio" name="plan" value={p.id} checked={plan === p.id} disabled={!p.bigger} onChange={() => setPlan(p.id)} />
              <span className="upgrade-plan-name">
                <strong>{p.name}</strong>
                {p.id === current && <span className="chip">{t.current}</span>}
              </span>
              <span className="upgrade-plan-specs muted small">
                {p.specs}
              </span>
              <span className="upgrade-plan-price">{p.monthly}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <section className="card stack">
        <h2 className="card-title">
          {t.changes}: {from.name} <ArrowRight size={16} aria-hidden /> {to.name}
        </h2>
        <div className="upgrade-changes">
          {changes.map((c) => (
            <div key={c.label} className="upgrade-change">
              <span>{c.label}</span>
              <span className="upgrade-change-values">
                <span className="muted">{c.from}</span>
                <ArrowRight size={14} aria-hidden className="muted" />
                <strong className="upgrade-new">{c.to}</strong>
                {c.diff && <span className="off">{c.diff}</span>}
              </span>
            </div>
          ))}
        </div>
      </section>

      <p className="notice success">{t.keepWorld}</p>
      <p className="notice warn">
        <Info size={16} aria-hidden /> {moveNote}
      </p>

      <section className="card stack">
        <div className="row">
          <span className="stack-tight">
            <strong>{t.cost}</strong>
            <span className="muted small">{costHint}</span>
            {to.cost?.atMinimum && <span className="muted small">{t.minimum}</span>}
          </span>
          <strong className="upgrade-cost">{to.cost?.amount}</strong>
        </div>
        <div className="row upgrade-after">
          <span className="muted">{t.after}</span>
          <span>{to.monthly}</span>
        </div>
      </section>

      <div className="card stack">
        <p className="muted small">{billing.methods}</p>
        <PaymentConsent legal={legal} />
        {state.error && <p className="error">{errors[state.error]}</p>}
        <button type="submit" disabled={pending}>
          {pending ? t.redirecting : `${t.pay} · ${to.cost?.amount}`}
        </button>
      </div>
    </form>
  );
}
