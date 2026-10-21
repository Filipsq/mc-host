"use client";

import { useState } from "react";
import { Check, Lightbulb, X } from "lucide-react";
import type { Plan } from "@prisma/client";
import { format, type Messages } from "@/i18n/messages";
import type { AddonOption, PlanOption } from "@/components/PlanPicker";
import type { AddonId } from "@/lib/addons";
import { formatPrice } from "@/lib/plans";
import type { Currency } from "@/i18n/config";
import { PLAYER_GROUPS, type PlayerGroup } from "@/lib/ram";
import {
  HELPER_EXTRAS,
  HELPER_PLATFORMS,
  contentFor,
  recommend,
  type HelperContent,
  type HelperExtra,
  type HelperPick,
  type HelperPlatform,
  type HelperReason,
} from "@/lib/planHelper";

type Props = {
  t: Messages["helper"];
  server: Messages["server"];
  terraria: Messages["terraria"];
  plans: PlanOption[];
  addons: AddonOption[];
  addonNames: Record<AddonId, string>;
  money: { locale: string; currency: string };
  freeTaken: boolean;
  open: boolean;
  onClose: () => void;
  onApply: (pick: HelperPick) => void;
};

/** "Pomóż mi zdecydować": four questions, a plan and game to start from, and a button that fills the form in. */
export default function PlanHelper({ t, server, terraria, plans, addons, addonNames, money, freeTaken, open, onClose, onApply }: Props) {
  const [platform, setPlatform] = useState<HelperPlatform>("java");
  const [players, setPlayers] = useState<PlayerGroup>(5);
  const [content, setContent] = useState<HelperContent>("vanilla");
  const [extras, setExtras] = useState<HelperExtra[]>([]);
  const [picked, setPicked] = useState<AddonId[]>([]);
  const [applied, setApplied] = useState(false);
  if (!open) return null;

  const contents = contentFor(platform);
  const pick = recommend({ platform, players, content, extras, addons: picked }, freeTaken);
  const plan = plans.find((p) => p.id === pick.plan)!;
  const planName = (id: Plan) => plans.find((p) => p.id === id)?.name ?? id;
  const price = (n: number) => formatPrice(n, money.currency as Currency, money.locale);
  const addonsHere = addons.filter((o) => o.id !== "domain" || platform === "java" || platform === "both");
  const monthly = plan.monthly + (pick.plan === "FREE" ? 0 : addons.filter((o) => pick.addons.includes(o.id)).reduce((sum, o) => sum + o.monthly, 0));
  const extrasHere = HELPER_EXTRAS.filter((e) => e !== "nonPremium" || platform === "java" || platform === "both");
  // Any change after "fill in" means the form no longer matches what's shown.
  const changed = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setApplied(false);
  };

  const gameName =
    pick.edition === "TERRARIA"
      ? `Terraria · ${terraria.kinds[pick.terrariaKind ?? "vanilla"]}`
      : pick.edition === "BEDROCK"
        ? "Minecraft Bedrock"
        : `Minecraft Java · ${server.games[pick.game ?? "survival"]}`;

  return (
    <section className="card helper-card" id="pomoc-wybor" aria-labelledby="helper-title">
      <header className="helper-head">
        <div className="stack-tight">
          <h2 className="helper-title" id="helper-title">
            <Lightbulb size={20} aria-hidden /> {t.title}
          </h2>
          <p className="muted small">{t.intro}</p>
        </div>
        <button type="button" className="icon-button helper-close" onClick={onClose} aria-label={t.close} title={t.close}>
          <X size={18} aria-hidden />
        </button>
      </header>
      <div className="helper-layout">
        <div className="helper-steps">
          <Step n={1} title={t.platform}>
            <div className="helper-options">
              {HELPER_PLATFORMS.map((p) => (
                <label key={p} className="choice">
                  <input type="radio" name="helper-platform" checked={platform === p} onChange={() => changed(setPlatform)(p)} />
                  <span className="stack-tight">
                    <strong>{t.platforms[p]}</strong>
                    <span className="muted small">{t.platformHints[p]}</span>
                  </span>
                </label>
              ))}
            </div>
          </Step>
          <Step n={2} title={t.players}>
            <div className="helper-players">
              {PLAYER_GROUPS.map((n) => (
                <label key={n} className="choice">
                  <input type="radio" name="helper-players" checked={players === n} onChange={() => changed(setPlayers)(n)} />
                  {t.playerGroups[n]}
                </label>
              ))}
            </div>
          </Step>
          <Step n={3} title={t.content}>
            {contents.length === 0 ? (
              <p className="muted small">{t.bedrockNoMods}</p>
            ) : (
              <div className="helper-options">
                {contents.map((c) => (
                  <label key={c} className="choice">
                    <input
                      type="radio"
                      name="helper-content"
                      // The first answer stands in when the platform changed under an answer it doesn't have.
                      checked={contents.includes(content) ? content === c : c === contents[0]}
                      onChange={() => changed(setContent)(c)}
                    />
                    <span className="stack-tight">
                      <strong>{c === "vanilla" && platform === "terraria" ? terraria.kinds.vanilla : t.contents[c]}</strong>
                      <span className="muted small">{t.contentHints[c]}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </Step>
          <Step n={4} title={t.extras} hint={t.extrasHint}>
            <div className="helper-extras">
              {extrasHere.map((e) => (
                <label key={e} className="check">
                  <input
                    type="checkbox"
                    checked={extras.includes(e)}
                    onChange={(ev) => changed(setExtras)(ev.target.checked ? [...extras, e] : extras.filter((x) => x !== e))}
                  />
                  <span className="stack-tight">
                    <span>{t.extrasList[e]}</span>
                    <span className="muted small">{t.extrasHints[e]}</span>
                  </span>
                </label>
              ))}
            </div>
            {addonsHere.length > 0 && (
              <div className="stack-tight">
                <p className="small helper-subtitle">{t.addonsTitle}</p>
                <div className="helper-extras">
                  {addonsHere.map((o) => (
                    <label key={o.id} className="check">
                      <input
                        type="checkbox"
                        checked={picked.includes(o.id)}
                        onChange={(ev) => changed(setPicked)(ev.target.checked ? [...picked, o.id] : picked.filter((x) => x !== o.id))}
                      />
                      <span className="stack-tight">
                        <span>
                          {o.name} <span className="addon-price small">+{price(o.monthly)}</span>
                        </span>
                        <span className="muted small">{o.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="helper-included">
              <p className="small">{t.included}</p>
              <ul>
                {t.includedList.map((x) => (
                  <li key={x} className="small">
                    <Check size={14} aria-hidden /> {x}
                  </li>
                ))}
              </ul>
            </div>
          </Step>
        </div>
        <aside className="helper-result" aria-live="polite">
          <p className="helper-result-label">{t.result}</p>
          <p className="helper-plan">
            <strong>{plan.name}</strong>{" "}
            <span>{monthly === 0 ? t.free : `${price(Math.round(monthly * 100) / 100)} ${t.perMonth}`}</span>
          </p>
          <p className="muted small">{plan.summary}</p>
          <ul className="ai-picks">
            <li className="chip">{gameName}</li>
            {pick.crossplay && <li className="chip">{t.chipCrossplay}</li>}
            {pick.nonPremium && <li className="chip">{t.chipNonPremium}</li>}
            {pick.addons.map((a) => (
              <li key={a} className="chip">
                {addonNames[a]}
              </li>
            ))}
          </ul>
          <ul className="helper-reasons">
            {pick.reasons.map((r) => (
              <li key={r.code} className="small">
                {reasonText(t, r, planName, money.locale)}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              onApply(pick);
              setApplied(true);
            }}
          >
            {t.apply}
          </button>
          {applied && (
            <p className="notice success small" role="status">
              {t.applied}
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}

function Step({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="helper-step stack" role="group" aria-label={title}>
      <p className="helper-step-title">
        <span className="helper-num" aria-hidden>
          {n}
        </span>
        <span>
          {title}
          {hint && <span className="muted small"> {hint}</span>}
        </span>
      </p>
      {children}
    </div>
  );
}

function reasonText(t: Messages["helper"], r: HelperReason, planName: (id: Plan) => string, locale: string) {
  const r2 = t.reasons;
  switch (r.code) {
    case "players":
      return r.max === null ? format(r2.playersUnlimited, { plan: planName(r.plan) }) : format(r2.players, { plan: planName(r.plan), max: r.max });
    case "ram":
      return format(r2.ram, { plan: planName(r.plan), gb: new Intl.NumberFormat(locale).format(r.gb), planGb: r.planGb });
    case "backups":
      return format(r2.backups, { plan: planName(r.plan), n: r.kept });
    default:
      return r2[r.code];
  }
}
