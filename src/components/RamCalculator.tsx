"use client";

import { useState } from "react";
import Link from "next/link";
import type { Plan } from "@prisma/client";
import { format, type Messages } from "@/i18n/messages";
import { PLAYER_GROUPS, RAM_USES, planFor, ramNeeded, type PlayerGroup, type RamUse } from "@/lib/ram";

type Props = {
  t: Messages["home"];
  planNames: Record<Plan, string>;
  prices: Record<Plan, string>; // formatted, per 30 days
  locale: string;
  start: string; // where "create a server" leads
};

/** Two questions, then how much RAM and which plan. */
export default function RamCalculator({ t, planNames, prices, locale, start }: Props) {
  const [use, setUse] = useState<RamUse>("plugins");
  const [players, setPlayers] = useState<PlayerGroup>(10);
  const gb = ramNeeded(use, players);
  const plan = planFor(use, players);
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });

  return (
    <div className="card ram-calculator stack" id="ram">
      <h3>{t.ramTitle}</h3>
      <p className="muted">{t.ramSubtitle}</p>
      <fieldset className="stack">
        <legend>{t.ramWhat}</legend>
        <div className="ram-options">
          {RAM_USES.map((u) => (
            <label key={u} className="choice">
              <input type="radio" name="ram-use" value={u} checked={use === u} onChange={() => setUse(u)} />
              <span className="stack-tight">
                <strong>{t.ramUses[u]}</strong>
                <span className="muted small">{t.ramUseHints[u]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="stack">
        <legend>{t.ramPlayers}</legend>
        <div className="row" style={{ justifyContent: "flex-start" }}>
          {PLAYER_GROUPS.map((n) => (
            <label key={n} className="choice">
              <input type="radio" name="ram-players" value={n} checked={players === n} onChange={() => setPlayers(n)} />
              {t.ramPlayerGroups[n]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="ram-result" aria-live="polite">
        <p>
          <strong>{format(t.ramResult, { gb: number.format(gb) })}</strong>{" "}
          {plan === null
            ? t.ramTooBig
            : plan === "FREE"
              ? t.ramFree
              : format(t.ramPlan, { plan: planNames[plan], price: prices[plan] })}
        </p>
        <p className="muted small">{t.ramNote}</p>
        <Link className="button" href={start}>
          {t.ramStart}
        </Link>
      </div>
    </div>
  );
}
