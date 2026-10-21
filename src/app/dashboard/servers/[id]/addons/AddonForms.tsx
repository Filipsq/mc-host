"use client";

import { useActionState, useState, useTransition } from "react";
import { buyAddonsAction, removeAddonAction } from "../../actions";
import { clearDomainAction, setDomainAction } from "./actions";
import PaymentConsent from "@/components/PaymentConsent";
import { format, type Messages } from "@/i18n/messages";
import type { AddonOption } from "@/components/PlanPicker";
import type { AddonId } from "@/lib/addons";

type BuyProps = {
  serverId: string;
  options: AddonOption[]; // the ones the server doesn't have yet
  // What each set of ticked add-ons costs now, keyed by their ids joined with "," in ADDONS order.
  costs: Record<string, string>;
  prices: Record<string, string>; // each add-on's 30-day price, formatted
  t: Messages["paidAddons"];
  billing: Messages["billing"];
  legal: Messages["legal"];
  errors: Messages["server"]["errors"];
  hint: string;
};

/** Ticks add-ons the server doesn't have and pays their share of the time left. */
export function BuyAddonsForm({ serverId, options, costs, prices, t, billing, legal, errors, hint }: BuyProps) {
  const [state, action, pending] = useActionState(buyAddonsAction.bind(null, serverId), {});
  const [ticked, setTicked] = useState<AddonId[]>([]);
  const key = options.filter((o) => ticked.includes(o.id)).map((o) => o.id).join(",");
  return (
    <form action={action} className="card stack">
      <h2 className="card-title">{t.buyTitle}</h2>
      <p className="muted small">{hint}</p>
      <div className="addon-options">
        {options.map((o) => (
          <label key={o.id} className="choice addon-choice">
            <input
              type="checkbox"
              name="addons"
              value={o.id}
              checked={ticked.includes(o.id)}
              onChange={(e) => setTicked((t) => (e.target.checked ? [...t, o.id] : t.filter((x) => x !== o.id)))}
            />
            <span className="stack-tight">
              <strong>{o.name}</strong>
              <span className="addon-price">{format(t.price, { price: prices[o.id] })}</span>
              <span className="muted small">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {key && (
        <p className="total">
          {t.buyTotal}: <strong>{costs[key]}</strong>
        </p>
      )}
      <p className="muted small">{billing.methods}</p>
      <PaymentConsent legal={legal} />
      {state.error && <p className="error">{errors[state.error]}</p>}
      <button type="submit" disabled={pending || !key}>
        {pending ? billing.redirecting : t.buy}
      </button>
    </form>
  );
}

/** Turns an add-on off after a second click, so a slip of the finger doesn't. */
export function RemoveAddonButton({ serverId, addon, label, confirm }: { serverId: string; addon: AddonId; label: string; confirm: string }) {
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  if (!asking) {
    return (
      <button type="button" className="secondary small" onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className="stack-tight addon-confirm">
      <span className="small">{confirm}</span>
      <span className="row">
        <button type="button" className="danger small" disabled={pending} onClick={() => start(() => removeAddonAction(serverId, addon))}>
          {label}
        </button>
        <button type="button" className="secondary small" onClick={() => setAsking(false)}>
          ✕
        </button>
      </span>
    </span>
  );
}

type DomainProps = {
  serverId: string;
  current: string | null;
  target: string; // the server's Java address, which the CNAME points at
  address: string;
  t: Messages["paidAddons"]["domain"];
};

/** The own domain: how to point it here, and the field that checks and saves it. */
export function DomainForm({ serverId, current, target, address, t }: DomainProps) {
  const [state, action, pending] = useActionState(setDomainAction.bind(null, serverId), {});
  const [clearing, startClear] = useTransition();
  const [typed, setTyped] = useState(current ?? "");
  // The record's name is the part before the owner's domain, e.g. "graj" in graj.mojserwer.pl.
  const name = typed.includes(".") && typed.split(".").length > 2 ? typed.split(".")[0] : "graj";
  return (
    <div className="stack">
      {current && <p className="notice success small">{format(t.active, { domain: current, address })}</p>}
      <p className="small">{t.steps}</p>
      <p className="mono small dns-record">
        {/* One field per line, so a phone doesn't break the address in the middle. */}
        {format(t.record, { name, target })
          .split(" · ")
          .map((part) => (
            <span key={part}>{part}</span>
          ))}
      </p>
      <p className="muted small">{t.wait}</p>
      <form action={action} className="stack">
        <label>
          {t.label}
          <input
            name="domain"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={t.placeholder}
            autoComplete="off"
            spellCheck={false}
            className="mono"
            required
          />
        </label>
        {state.error && <p className="error small">{format(t.errors[state.error], { target })}</p>}
        <div className="row" style={{ justifyContent: "flex-start" }}>
          <button type="submit" disabled={pending}>
            {pending ? t.saving : t.save}
          </button>
          {current && (
            <button type="button" className="secondary" disabled={clearing} onClick={() => startClear(() => clearDomainAction(serverId))}>
              {t.clear}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
