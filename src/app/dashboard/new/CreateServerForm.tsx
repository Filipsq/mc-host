"use client";

import { startTransition, useActionState, useState } from "react";
import Link from "next/link";
import type { Plan } from "@prisma/client";
import { createServerAction } from "../servers/actions";
import PlanPicker, { type PlanOption } from "@/components/PlanPicker";
import EditionIcon from "@/components/EditionIcon";
import PaymentConsent from "@/components/PaymentConsent";
import { format, type Messages } from "@/i18n/messages";
import { CURATED_PACKS, MODPACK_MIN_PLAN, planAtLeast, planForRam } from "@/lib/modpacks";
import { GAMES, gameById, gamePluginTitles, isGameId, type GameId } from "@/lib/games";
import { planById } from "@/lib/plans";
import type { Suggestion } from "@/lib/ai";
import AiCreator from "./AiCreator";

type Props = {
  t: Messages["server"];
  billing: Messages["billing"];
  legal: Messages["legal"];
  plans: PlanOption[];
  defaultPlan: Plan;
  domain: string;
  money: { locale: string; currency: string };
  initialGame?: GameId; // a game or pack picked on the home page or the empty panel
  initialPack?: string;
  packIcons: Record<string, string | undefined>;
  /** Set when the AI creator is on. */
  ai?: {
    t: Messages["ai"];
    settings: Messages["settings"];
    limits: { daily: number; length: number };
    initialPrompt?: string;
  };
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

export default function CreateServerForm({ t, billing, legal, plans, defaultPlan, domain, money, initialGame, initialPack, packIcons, ai }: Props) {
  const [state, action, pending] = useActionState(createServerAction, {});
  const v = state.values ?? {};
  const [edition, setEdition] = useState(v.edition ?? "JAVA");
  const [subdomain, setSubdomain] = useState(v.subdomain ?? "");
  const [subdomainEdited, setSubdomainEdited] = useState(!!v.subdomain);
  const [plan, setPlan] = useState<Plan>((v.plan as Plan | undefined) ?? defaultPlan);
  const [game, setGame] = useState<GameId>(isGameId(v.game) ? v.game : (initialGame ?? "survival"));
  const [pack, setPack] = useState(v.pack ?? initialPack ?? CURATED_PACKS[0].slug);
  const [name, setName] = useState(v.name ?? "");
  // What the AI creator picked beyond the form's own fields; sent as hidden fields.
  const [aiSettings, setAiSettings] = useState<Pick<Suggestion, "gameMode" | "difficulty" | "pvp" | "motd" | "plugins"> | null>(null);
  // Bumped by each AI suggestion so the plan picker starts from the suggested plan.
  const [aiRound, setAiRound] = useState(0);

  function applySuggestion(s: Suggestion) {
    setEdition(s.edition);
    setName(s.name);
    setSubdomain(slugify(s.name));
    setSubdomainEdited(false);
    setGame(s.game);
    if (s.pack) setPack(s.pack);
    setPlan(s.plan);
    setAiSettings({ gameMode: s.gameMode, difficulty: s.difficulty, pvp: s.pvp, motd: s.motd, plugins: s.plugins });
    setAiRound((n) => n + 1);
  }
  const modded = edition === "JAVA" && game === "modpack";
  const curated = CURATED_PACKS.find((p) => p.slug === pack);
  // Mod packs need a paid plan with enough memory for the pack, so smaller plans can't be picked for them.
  const minPlan = modded ? (curated ? planForRam(curated.ramGb) : MODPACK_MIN_PLAN) : "FREE";
  const planChoices = plans.map((p) =>
    planAtLeast(p.id, minPlan) || p.disabledNote ? p : { ...p, disabledNote: p.id === "FREE" ? t.modpackNoFree : t.packTooSmall },
  );
  const planName = (id: Plan) => plans.find((p) => p.id === id)?.name ?? id;
  // A ready game that's comfortable with more memory than the chosen plan has.
  const wanted = edition === "JAVA" && !modded ? gameById(game).ramGb : 0;
  const ramLow = wanted > planById(plan).ramGb;

  return (
    <>
    {ai && (
      <AiCreator
        t={ai.t}
        server={t}
        settings={ai.settings}
        planNames={Object.fromEntries(plans.map((p) => [p.id, p.name]))}
        limits={ai.limits}
        initialPrompt={ai.initialPrompt}
        onSuggestion={applySuggestion}
        onDiscardSettings={() => setAiSettings(null)}
      />
    )}
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
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!subdomainEdited) setSubdomain(slugify(e.target.value));
          }}
        />
      </label>
      {aiSettings && (
        <>
          <input type="hidden" name="gameMode" value={aiSettings.gameMode} />
          <input type="hidden" name="difficulty" value={aiSettings.difficulty} />
          <input type="hidden" name="pvp" value={aiSettings.pvp ? "on" : "off"} />
          <input type="hidden" name="motd" value={aiSettings.motd} />
          <input type="hidden" name="extraPlugins" value={aiSettings.plugins.join(",")} />
        </>
      )}
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
          <legend>{t.game}</legend>
          <div className="plan-options">
            {GAMES.map((g) => {
              const extras = gamePluginTitles(g.id);
              return (
                <label key={g.id} className="choice plan-choice">
                  <input
                    type="radio"
                    name="game"
                    value={g.id}
                    checked={game === g.id}
                    onChange={() => {
                      setGame(g.id);
                      if (g.kind === "modpack") {
                        const min = curated ? planForRam(curated.ramGb) : MODPACK_MIN_PLAN;
                        if (!planAtLeast(plan, min)) setPlan(min);
                      }
                    }}
                  />
                  <span className="stack-tight">
                    <strong>{t.games[g.id]}</strong>
                    <span className="muted small">{t.gameHints[g.id]}</span>
                    {extras.length > 0 && <span className="small">{format(t.withPlugins, { list: extras.join(", ") })}</span>}
                    <span className="ram-pill">{format(t.ramFrom, { gb: g.ramGb })}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}
      {modded && (
        <fieldset className="stack">
          <legend>{t.modpack}</legend>
          {CURATED_PACKS.map((p) => (
            <label key={p.slug} className="choice plan-choice">
              <input
                type="radio"
                name="pack"
                value={p.slug}
                checked={pack === p.slug}
                onChange={() => {
                  setPack(p.slug);
                  const min = planForRam(p.ramGb);
                  if (!planAtLeast(plan, min)) setPlan(min);
                }}
              />
              {packIcons[p.slug] && (
                // eslint-disable-next-line @next/next/no-img-element -- small icons through /api/plugin-icon
                <img className="pack-option-icon" src={packIcons[p.slug]} alt="" width={40} height={40} loading="lazy" referrerPolicy="no-referrer" />
              )}
              <span className="stack-tight">
                <span>
                  <strong>{p.title}</strong> <span className="muted">{t.packs[p.slug]}</span>
                </span>
                <span className="pack-meta">
                  <span className="ram-pill">{format(t.ramFrom, { gb: p.ramGb })}</span>
                  <span className="muted small">{format(t.packPlan, { plan: planName(planForRam(p.ramGb)) })}</span>
                </span>
              </span>
            </label>
          ))}
          <label className="choice">
            <input
              type="radio"
              name="pack"
              value="custom"
              checked={pack === "custom"}
              onChange={() => {
                setPack("custom");
                if (!planAtLeast(plan, MODPACK_MIN_PLAN)) setPlan(MODPACK_MIN_PLAN);
              }}
            />
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
        // Remounted when a mod pack rules out smaller plans, so it picks up the new default.
        key={`${minPlan}-${aiRound}`}
        plans={planChoices}
        defaultPlan={plan}
        periodLabels={{ days: billing.periodDays, off: billing.periodOff }}
        labels={{ plan: t.plan, period: t.period, total: billing.total }}
        formatMoney={money}
        onPlanChange={setPlan}
      />
      {ramLow && (
        <p className="notice warn">
          {format(t.ramLow, { game: t.games[game], gb: wanted, plan: planById(plan).ramGb })}
        </p>
      )}
      <p className="muted small">
        {t.ramHelp}{" "}
        <Link href="/#ram" target="_blank">
          {t.ramHelpLink}
        </Link>
      </p>
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
    </>
  );
}
