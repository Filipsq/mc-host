"use client";

import { useActionState, useState } from "react";
import type { Plan } from "@prisma/client";
import { createServerAction } from "../servers/actions";
import PlanPicker, { type PlanOption } from "@/components/PlanPicker";
import EditionIcon from "@/components/EditionIcon";
import PaymentConsent from "@/components/PaymentConsent";
import type { Messages } from "@/i18n/messages";

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

  return (
    <form action={action} className="card stack">
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
      <PlanPicker
        plans={plans}
        defaultPlan={(v.plan as Plan | undefined) ?? defaultPlan}
        periodLabels={{ 1: billing.months1, 3: billing.months3 }}
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
