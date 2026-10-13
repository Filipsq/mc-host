"use client";

import { useState } from "react";
import Link from "next/link";
import type { Plan } from "@prisma/client";
import { format, type Messages } from "@/i18n/messages";
import { PLAYER_GROUPS, RAM_USES, planFor, ramNeeded, type PlayerGroup, type RamUse } from "@/lib/ram";
import { planById } from "@/lib/plans";

// The bar has one block per gigabyte, up to the biggest plan.
const BAR_GB = 10;

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
        {/* Blocks fill up to the memory needed; the dashed outline is what the suggested plan has. */}
        <div className="ram-bar" aria-hidden>
          {Array.from({ length: BAR_GB }, (_, i) => {
            const fill = Math.min(1, Math.max(0, gb - i));
            const inPlan = plan !== null && i < planById(plan).ramGb;
            return (
              <span
                key={i}
                className={`ram-block${fill === 1 ? " full" : fill > 0 ? " half" : ""}${inPlan ? " in-plan" : ""}`}
                style={{ "--i": i } as React.CSSProperties}
              >
                <span className="ram-block-gb">{i + 1}</span>
              </span>
            );
          })}
        </div>
        <p className="ram-legend muted small">
          <span className="ram-key ram-key-need" /> {format(t.ramLegendNeed, { gb: number.format(gb) })}
          {plan !== null && (
            <>
              {" "}
              <span className="ram-key ram-key-plan" /> {format(t.ramLegendPlan, { plan: planNames[plan], gb: planById(plan).ramGb })}
            </>
          )}
        </p>
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
