"use client";

import { startTransition, useActionState, useState } from "react";
import Link from "next/link";
import type { Edition, Plan } from "@prisma/client";
import { createServerAction } from "../servers/actions";
import PlanPicker, { type PlanOption } from "@/components/PlanPicker";
import EditionIcon from "@/components/EditionIcon";
import PaymentConsent from "@/components/PaymentConsent";
import { format, type Messages } from "@/i18n/messages";
import { CURATED_PACKS, MODPACK_MIN_PLAN, isModLoader, planAtLeast, planForRam, type ModLoader } from "@/lib/modpacks";
import { MOD_DEFAULT_VERSION } from "@/lib/settings";
import { GAMES, gameById, gamePluginTitles, isGameId, type GameId } from "@/lib/games";
import { planById } from "@/lib/plans";
import { canCrossplay, canRunNonPremium } from "@/lib/plugins";
import { EDITION_NAMES } from "@/lib/editions";
import { SERVER_PASSWORD_MAX, TERRARIA_KINDS, WORLD_DIFFICULTIES, WORLD_SIZES } from "@/lib/terraria";
import type { Suggestion } from "@/lib/ai";
import AiCreator from "./AiCreator";
import { LoaderFields, PackFields, type CurseforgeOption } from "./ModFields";

type Props = {
  t: Messages["server"];
  terraria: Messages["terraria"];
  initialEdition?: Edition; // Terraria, when picked on the home page
  settings: Messages["settings"];
  billing: Messages["billing"];
  legal: Messages["legal"];
  plans: PlanOption[];
  defaultPlan: Plan;
  domain: string;
  money: { locale: string; currency: string };
  initialGame?: GameId; // a game or pack picked on the home page or the empty panel
  initialPack?: string;
  packIcons: Record<string, string | undefined>;
  cfPack?: CurseforgeOption; // a CurseForge pack picked on the home page
  curseforge: boolean; // whether CurseForge links work
  /** Set when the AI creator is on. */
  ai?: {
    t: Messages["ai"];
    settings: Messages["settings"];
    limits: { daily: number; length: number };
    initialPrompt?: string;
  };
};

// "Serwer Ekipy!" -> "serwer-ekipy-", while typing: Polish letters lose
// their accents and anything else an address can't have becomes one hyphen.
function toAddress(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/Ł/g, "L")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 32);
}

// "Serwer Ekipy" -> "serwer-ekipy"
function slugify(name: string) {
  return toAddress(name).replace(/-+$/, "");
}

export default function CreateServerForm({ t, terraria, initialEdition, settings, billing, legal, plans, defaultPlan, domain, money, initialGame, initialPack, packIcons, cfPack, curseforge, ai }: Props) {
  const [state, action, pending] = useActionState(createServerAction, {});
  const v = state.values ?? {};
  const [edition, setEdition] = useState(v.edition ?? initialEdition ?? "JAVA");
  const [subdomain, setSubdomain] = useState(v.subdomain ?? "");
  const [subdomainEdited, setSubdomainEdited] = useState(!!v.subdomain);
  const [plan, setPlan] = useState<Plan>((v.plan as Plan | undefined) ?? defaultPlan);
  const [game, setGame] = useState<GameId>(isGameId(v.game) ? v.game : (initialGame ?? "survival"));
  const [pack, setPack] = useState(v.pack ?? initialPack ?? CURATED_PACKS[0].slug);
  const [name, setName] = useState(v.name ?? "");
  const [loader, setLoader] = useState<ModLoader>(isModLoader(v.loader) ? v.loader : "fabric");
  const [modVersion, setModVersion] = useState(v.modVersion ?? MOD_DEFAULT_VERSION);
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
  const mods = edition === "JAVA" && game === "mods";
  // Mod packs need a paid plan with enough memory for the pack, so smaller plans can't be picked for them.
  const packPlan = (slug: string) => {
    const gb = slug === "curseforge" ? cfPack?.ramGb : CURATED_PACKS.find((p) => p.slug === slug)?.ramGb;
    return gb ? planForRam(gb) : MODPACK_MIN_PLAN;
  };
  const minPlan = modded ? packPlan(pack) : "FREE";
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
        {(["JAVA", "BEDROCK", "TERRARIA"] as const).map((ed) => (
          <label key={ed} className="choice">
            <input type="radio" name="edition" value={ed} checked={edition === ed} onChange={() => setEdition(ed)} />
            <EditionIcon edition={ed} size={30} />
            <span>
              <strong>{ed === "TERRARIA" ? EDITION_NAMES[ed] : `Minecraft ${EDITION_NAMES[ed]}`}</strong>{" "}
              <span className="muted">{{ JAVA: t.javaHint, BEDROCK: t.bedrockHint, TERRARIA: terraria.hint }[ed]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {edition === "TERRARIA" && <TerrariaFields t={terraria} values={v} />}
      {edition === "JAVA" && (
        <label>
          {t.subdomain}
          <span className="address-input">
            <input
              name="subdomain"
              required
              minLength={3}
              maxLength={32}
              value={subdomain}
              onChange={(e) => {
                setSubdomainEdited(true);
                setSubdomain(toAddress(e.target.value));
                e.target.setCustomValidity("");
              }}
              onBlur={() => setSubdomain((a) => a.replace(/-+$/, ""))}
              // The browser's own "Podaj wartość w wymaganym formacie" doesn't say what's wrong.
              onInvalid={(e) => e.currentTarget.setCustomValidity(t.errors.invalidSubdomain)}
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
                      if (g.kind === "modpack" && !planAtLeast(plan, packPlan(pack))) setPlan(packPlan(pack));
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
        <PackFields
          t={t}
          pack={pack}
          onPack={(slug) => {
            setPack(slug);
            if (!planAtLeast(plan, packPlan(slug))) setPlan(packPlan(slug));
          }}
          packIcons={packIcons}
          cfPack={cfPack}
          curseforge={curseforge}
          planName={planName}
          locale={money.locale}
          initialLink={v.packLink}
        />
      )}
      {mods && <LoaderFields t={t} loader={loader} version={modVersion} onLoader={setLoader} onVersion={setModVersion} />}
      {edition === "JAVA" && canRunNonPremium({ edition, kind: gameById(game).kind }) && (
        <label className="check">
          <input type="checkbox" name="nonPremium" defaultChecked={v.nonPremium === "on"} />
          <span className="stack-tight">
            <span>{settings.nonPremium}</span>
            <span className="muted small">{t.nonPremiumHint}</span>
          </span>
        </label>
      )}
      {edition === "JAVA" && canCrossplay({ edition, kind: gameById(game).kind }) && (
        <label className="check">
          {/* On unless the owner turned it off before an error sent the form back. */}
          <input type="checkbox" name="crossplay" defaultChecked={v.name === undefined || v.crossplay === "on"} />
          <span className="stack-tight">
            <span>{settings.crossplay}</span>
            <span className="muted small">{t.crossplayHint}</span>
          </span>
        </label>
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
      {edition !== "TERRARIA" && (
        <p className="muted small">
          {t.ramHelp}{" "}
          <Link href="/#ram" target="_blank">
            {t.ramHelpLink}
          </Link>
        </p>
      )}
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

/** A Terraria server's type and the world it makes on its first start. */
function TerrariaFields({ t, values }: { t: Messages["terraria"]; values: Record<string, string> }) {
  return (
    <>
      <fieldset className="stack">
        <legend>{t.kind}</legend>
        <div className="plan-options">
          {TERRARIA_KINDS.map((k) => (
            <label key={k} className="choice plan-choice">
              <input type="radio" name="terrariaKind" value={k} defaultChecked={(values.terrariaKind ?? "vanilla") === k} />
              <span className="stack-tight">
                <strong>{t.kinds[k]}</strong>
                <span className="muted small">{t.kindHints[k]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="option-row">
        <label>
          {t.size}
          <select name="worldSize" defaultValue={values.worldSize ?? "medium"}>
            {WORLD_SIZES.map((s) => (
              <option key={s} value={s}>
                {t.sizes[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.difficulty}
          <select name="worldDifficulty" defaultValue={values.worldDifficulty ?? "classic"}>
            {WORLD_DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {t.difficulties[d]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        {t.seed}
        <input name="seed" maxLength={32} defaultValue={values.seed ?? ""} spellCheck={false} />
        <span className="muted small">{t.seedHint}</span>
      </label>
      <label>
        {t.password}
        <input name="password" maxLength={SERVER_PASSWORD_MAX} defaultValue={values.password ?? ""} autoComplete="off" spellCheck={false} />
        <span className="muted small">{t.passwordHint}</span>
      </label>
    </>
  );
}
