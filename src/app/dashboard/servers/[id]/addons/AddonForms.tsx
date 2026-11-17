"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { buyAddonsAction, buyDomainAction, removeAddonAction } from "../../actions";
import PayBadges from "@/components/PayBadges";
import CopyButton from "@/components/CopyButton";
import { clearDomainAction, setDomainAction } from "./actions";
import PaymentConsent from "@/components/PaymentConsent";
import AdminTestBuy from "@/components/AdminTestBuy";
import { format, type Messages } from "@/i18n/messages";
import type { AddonOption } from "@/components/PlanPicker";
import type { AddonId } from "@/lib/addons";

type BuyProps = {
  serverId: string;
  options: AddonOption[]; // the ones the server doesn't have yet
  // What each set of ticked add-ons costs now, keyed by their ids joined with "," in ADDONS order.
  costs: Record<string, string>;
  prices: Record<string, string>; // each add-on's price line, ready to show ("+5 zł / 30 dni")
  t: Messages["paidAddons"];
  billing: Messages["billing"];
  legal: Messages["legal"];
  errors: Messages["server"]["errors"];
  hint: string;
  adminTest?: boolean; // an admin's test server: a free test purchase is offered too
  title?: string; // instead of "Dokup dodatki"
  preselect?: AddonId[]; // ticked from the start (the address page offers only the domain)
};

/** Ticks add-ons the server doesn't have and pays their share of the time left. */
export function BuyAddonsForm({ serverId, options, costs, prices, t, billing, legal, errors, hint, adminTest, title, preselect }: BuyProps) {
  const [state, action, pending] = useActionState(buyAddonsAction.bind(null, serverId), {});
  const [ticked, setTicked] = useState<AddonId[]>(preselect ?? []);
  const key = options.filter((o) => ticked.includes(o.id)).map((o) => o.id).join(",");
  return (
    <form action={action} className="card stack">
      <h2 className="card-title">{title ?? t.buyTitle}</h2>
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
              <span className="addon-price">{prices[o.id]}</span>
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
      {key && <AdminTestBuy show={adminTest} pending={pending} t={billing} />}
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
  target: string; // the server's Java address, which a CNAME would point at
  ips: string[]; // the public IPs players reach the server at, for the A record
  address: string;
  t: Messages["paidAddons"]["domain"];
  copy: { label: string; copied: string };
};

// Registries that sell names one level down (kokolino.com.pl), so "kokolino" is
// part of the bought domain, not a record name.
const TWO_PART_SUFFIXES = ["com.pl", "net.pl", "org.pl", "info.pl", "biz.pl", "waw.pl", "edu.pl", "co.uk", "org.uk", "com.de"];

/** "graj.kokolino.pl" -> "graj", "kokolino.pl" -> "@" (the domain itself). */
export function recordName(domain: string) {
  const labels = cleanTyped(domain).split(".").filter(Boolean);
  if (labels.length < 2) return "graj";
  const bought = TWO_PART_SUFFIXES.some((s) => labels.slice(-2).join(".") === s) ? 3 : 2;
  return labels.length > bought ? labels.slice(0, labels.length - bought).join(".") : "@";
}

function cleanTyped(input: string) {
  return input.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/[/:].*$/, "").replace(/\.$/, "");
}

// The record is often still on its way through DNS when the owner clicks, so
// the panel keeps checking by itself, for up to an hour.
const RECHECK_MS = 60_000;
const RECHECK_TRIES = 60;

/** The own domain: what record to add (copyable), where, and the field that checks and saves it. */
export function DomainForm({ serverId, current, target, ips, address, t, copy }: DomainProps) {
  const [state, action, pending] = useActionState(setDomainAction.bind(null, serverId), {});
  const [clearing, startClear] = useTransition();
  const [, startCheck] = useTransition();
  const [typed, setTyped] = useState(current ?? "");
  const [tries, setTries] = useState(0);
  const lastSent = useRef("");
  const name = recordName(typed);
  const useA = ips.length > 0;
  const record = useA ? { type: "A", value: ips[0] } : { type: "CNAME", value: target };
  const waiting = !pending && (state.error === "dnsMissing" || state.error === "dnsWrong") && cleanTyped(typed) === lastSent.current;

  useEffect(() => {
    if (!waiting || tries >= RECHECK_TRIES) return;
    const timer = setTimeout(() => {
      const form = new FormData();
      form.set("domain", lastSent.current);
      setTries((n) => n + 1);
      startCheck(() => action(form));
    }, RECHECK_MS);
    return () => clearTimeout(timer);
  }, [waiting, tries, action]);

  const field = (label: string, value: string, note?: string) => (
    <div className="dns-field">
      <span className="muted small">{label}</span>
      <span className="row dns-value">
        <strong className="mono">{value}</strong>
        <CopyButton text={value} label={copy.label} copiedLabel={copy.copied} />
      </span>
      {note && <span className="muted small">{note}</span>}
    </div>
  );

  return (
    <div className="stack">
      {current && <p className="notice success small">{format(t.active, { domain: current, address })}</p>}
      <p className="small">{t.intro}</p>
      <form
        action={(form) => {
          lastSent.current = cleanTyped(String(form.get("domain") ?? ""));
          setTries(0);
          action(form);
        }}
        className="stack"
      >
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
        <p className="small">{t.steps}</p>
        <div className="dns-record">
          {field(t.recordType, record.type)}
          {field(t.recordName, name, name === "@" ? t.rootNote : undefined)}
          {field(t.recordValue, record.value)}
        </div>
        {useA && <p className="muted small">{format(t.cnameAlt, { name, target })}</p>}
        <details className="small">
          <summary>{t.guidesTitle}</summary>
          <ul className="stack-tight">
            {t.guides.map((g) => (
              <li key={g.name}>
                <strong>{g.name}:</strong> {g.text}
              </li>
            ))}
          </ul>
        </details>
        <p className="muted small">{t.wait}</p>
        {state.error && <p className="error small">{format(t.errors[state.error], { target, ip: record.value, type: record.type })}</p>}
        {waiting && tries < RECHECK_TRIES && <p className="muted small">{t.rechecking}</p>}
        {state.saved && !current && <p className="notice success small">{t.saved}</p>}
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

type BuyDomainProps = {
  serverId: string;
  price: string;
  days: number;
  paysafecard: boolean;
  again: boolean; // already paid for: this adds more days
  t: Messages["paidAddons"]["free"];
  billing: Messages["billing"];
  legal: Messages["legal"];
  errors: Messages["server"]["errors"];
  adminTest?: boolean;
};

/** Buys an own domain for a free server, for `days` at a time (like console joining). */
export function BuyDomainForm({ serverId, price, days, paysafecard, again, t, billing, legal, errors, adminTest }: BuyDomainProps) {
  const [state, action, pending] = useActionState(buyDomainAction.bind(null, serverId), {});
  return (
    <form action={action} className="stack">
      <p>
        <strong>{format(again ? t.buyMore : t.buyTitle, { price, days })}</strong>
      </p>
      <p className="muted small">{paysafecard ? billing.methodsCashbill : billing.methods}</p>
      <PaymentConsent legal={legal} />
      {state.error && <p className="error">{errors[state.error]}</p>}
      <div className="pay-buttons">
        <button type="submit" className="pay-button" disabled={pending}>
          <span className="pay-label">{pending ? billing.redirecting : t.buy}</span>
          <PayBadges method={paysafecard ? "cards" : "stripe"} />
        </button>
        {paysafecard && (
          <button type="submit" className="secondary pay-button" name="method" value="paysafecard" disabled={pending}>
            <span className="pay-label">{billing.paysafecard}</span>
            <PayBadges method="cashbill" />
          </button>
        )}
      </div>
      <AdminTestBuy show={adminTest} pending={pending} t={billing} />
    </form>
  );
}
