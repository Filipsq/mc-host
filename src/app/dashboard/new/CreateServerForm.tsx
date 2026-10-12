"use client";

import { startTransition, useActionState, useState } from "react";
import type { Plan } from "@prisma/client";
import { createServerAction } from "../servers/actions";
import PlanPicker, { type PlanOption } from "@/components/PlanPicker";
import EditionIcon from "@/components/EditionIcon";
import PaymentConsent from "@/components/PaymentConsent";
import type { Messages } from "@/i18n/messages";
import { CURATED_PACKS, SERVER_KINDS, isServerKind, type ServerKind } from "@/lib/modpacks";

type Props = {
  t: Messages["server"];
  billing: Messages["billing"];
  legal: Messages["legal"];
  plans: PlanOption[];
  defaultPlan: Plan;
  domain: string;
  money: { locale: string; currency: string };
};

// "Serwer Ekipy" -> "serwer-ekipy"
function slugify(name: string) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export default function CreateServerForm({ t, billing, legal, plans, defaultPlan, domain, money }: Props) {
  const [state, action, pending] = useActionState(createServerAction, {});
  const v = state.values ?? {};
  const [edition, setEdition] = useState(v.edition ?? "JAVA");
  const [subdomain, setSubdomain] = useState(v.subdomain ?? "");
  const [subdomainEdited, setSubdomainEdited] = useState(!!v.subdomain);
  const [plan, setPlan] = useState<Plan>((v.plan as Plan | undefined) ?? defaultPlan);
  const [kind, setKind] = useState<ServerKind>(isServerKind(v.kind) ? v.kind : "vanilla");
  const [pack, setPack] = useState(v.pack ?? CURATED_PACKS[0].slug);
  const modded = edition === "JAVA" && kind === "modpack";
  // Mod packs need a paid plan, so the free one can't be picked for them.
  const planChoices = modded
    ? plans.map((p) => (p.id === "FREE" ? { ...p, disabledNote: p.disabledNote ?? t.modpackNoFree } : p))
    : plans;

  return (
    <form
      className="card stack"
      // `action` only serves a submit made before the page's script has loaded.
      action={action}
      onSubmit={(e) => {
        // Submitted by hand rather than through `action`, which resets the form after an
        // error and leaves the radio buttons out of step with what's shown.
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <label>
        {t.name}
        <input
          name="name"
          required
          minLength={3}
          maxLength={32}
          placeholder={t.namePlaceholder}
          defaultValue={v.name}
          key={v.name}
          onChange={(e) => {
            if (!subdomainEdited) setSubdomain(slugify(e.target.value));
          }}
        />
      </label>
      <fieldset className="stack">
        <legend>{t.edition}</legend>
        {(["JAVA", "BEDROCK"] as const).map((ed) => (
          <label key={ed} className="choice">
            <input type="radio" name="edition" value={ed} checked={edition === ed} onChange={() => setEdition(ed)} />
            <EditionIcon edition={ed} size={30} />
            <span>
              <strong>{ed === "JAVA" ? "Java" : "Bedrock"}</strong>{" "}
              <span className="muted">{ed === "JAVA" ? t.javaHint : t.bedrockHint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {edition === "JAVA" && (
        <label>
          {t.subdomain}
          <span className="address-input">
            <input
              name="subdomain"
              required
              minLength={3}
              maxLength={32}
              pattern="[a-z0-9][a-z0-9\-]{1,30}[a-z0-9]"
              value={subdomain}
              onChange={(e) => {
                setSubdomainEdited(true);
                setSubdomain(e.target.value.toLowerCase());
              }}
            />
            <span className="muted">.{domain}</span>
          </span>
          <span className="muted small">{t.subdomainHint}</span>
        </label>
      )}
      {edition === "JAVA" && (
        <fieldset className="stack">
          <legend>{t.kind}</legend>
          {SERVER_KINDS.map((k) => (
            <label key={k} className="choice">
              <input
                type="radio"
                name="kind"
                value={k}
                checked={kind === k}
                onChange={() => {
                  setKind(k);
                  if (k === "modpack" && plan === "FREE") setPlan("STARTER");
                }}
              />
              <span>
                <strong>{t.kinds[k]}</strong> <span className="muted">{t.kindHints[k]}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {modded && (
        <fieldset className="stack">
          <legend>{t.modpack}</legend>
          {CURATED_PACKS.map((p) => (
            <label key={p.slug} className="choice">
              <input type="radio" name="pack" value={p.slug} checked={pack === p.slug} onChange={() => setPack(p.slug)} />
              <span>
                <strong>{p.title}</strong> <span className="muted">{t.packs[p.slug]}</span>
              </span>
            </label>
          ))}
          <label className="choice">
            <input type="radio" name="pack" value="custom" checked={pack === "custom"} onChange={() => setPack("custom")} />
            <span>
              <strong>{t.packOther}</strong> <span className="muted">{t.packOtherHint}</span>
            </span>
          </label>
          {pack === "custom" && (
            <label>
              {t.packLink}
              <input
                name="packLink"
                required
                maxLength={300}
                placeholder="https://modrinth.com/modpack/..."
                defaultValue={v.packLink}
              />
            </label>
          )}
          <p className="muted small">{t.modpackNote}</p>
        </fieldset>
      )}
      <PlanPicker
        // Remounted when mod packs rule out the free plan, so it picks up the new default.
        key={modded ? "modded" : "any"}
        plans={planChoices}
        defaultPlan={plan}
        periodLabels={{ days: billing.periodDays, off: billing.periodOff }}
        labels={{ plan: t.plan, period: t.period, total: billing.total }}
        formatMoney={money}
        onPlanChange={setPlan}
      />
      {plan !== "FREE" && (
        <>
          <p className="muted small">{billing.methods}</p>
          <PaymentConsent legal={legal} />
        </>
      )}
      {state.error && <p className="error">{t.errors[state.error]}</p>}
      <button type="submit" disabled={pending}>
        {pending ? (plan === "FREE" ? t.creating : billing.redirecting) : plan === "FREE" ? t.create : t.createAndPay}
      </button>
    </form>
  );
}
