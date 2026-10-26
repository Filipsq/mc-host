"use client";

import { startTransition, useActionState, useState } from "react";
import Link from "next/link";
import type { Edition, Plan } from "@prisma/client";
import { createServerAction } from "../servers/actions";
import PlanPicker, { type AddonOption, type PlanOption } from "@/components/PlanPicker";
import { addonList, type AddonId } from "@/lib/addons";
import EditionIcon from "@/components/EditionIcon";
import PaymentConsent from "@/components/PaymentConsent";
import { format, type Messages } from "@/i18n/messages";
import { CURATED_PACKS, MODPACK_MIN_PLAN, isModLoader, planAtLeast, planForRam, type ModLoader } from "@/lib/modpacks";
import { MOD_DEFAULT_VERSION } from "@/lib/settings";
import { GAMES, gameById, gamePluginTitles, isGameId, type GameId } from "@/lib/games";
import { planById } from "@/lib/plans";
import { LOGIN_MODS, canCrossplay, canRunNonPremium } from "@/lib/plugins";
import { EDITION_NAMES } from "@/lib/editions";
import { SERVER_PASSWORD_MAX, TERRARIA_KINDS, TMOD_MIN_PLAN, WORLD_DIFFICULTIES, WORLD_SIZES, isTerrariaKind, type TerrariaKind } from "@/lib/terraria";
import type { Suggestion } from "@/lib/ai";
import type { HelperPick } from "@/lib/planHelper";
import { Lightbulb } from "lucide-react";
import AiCreator from "./AiCreator";
import PlanHelper from "./PlanHelper";
import { LoaderFields, PackFields, pickedCurseforge, type CurseforgeOption } from "./ModFields";

type Props = {
  title: string;
  t: Messages["server"];
  helper: Messages["helper"];
  paidAddons: Messages["paidAddons"];
  terraria: Messages["terraria"];
  initialEdition?: Edition; // Terraria, when picked on the home page
  settings: Messages["settings"];
  billing: Messages["billing"];
  legal: Messages["legal"];
  plans: PlanOption[];
  addonOptions: AddonOption[];
  defaultPlan: Plan;
  domain: string;
  money: { locale: string; currency: string };
  initialGame?: GameId; // a game or pack picked on the home page or the empty panel
  initialPack?: string;
  packIcons: Record<string, string | undefined>;
  cfPacks: CurseforgeOption[]; // CurseForge packs offered: the one picked on the home page first, then the popular ones
  cfPicked: boolean; // whether the first of cfPacks was picked on the home page
  curseforge: boolean; // whether CurseForge links work
  admin: boolean; // admins also get a button to make a test server without paying
  // The creator code to start with (whoever invited the user) and free Starters they earned with their own (creator.ts).
  creator: { t: Messages["creator"]; code: string; freeStarters: number; discount: number; days: number };
  // A gift code opened on the redeem page (gifts.ts): its plan is paid for with it.
  gift?: { code: string; plan: Plan; label: string; hint: string };
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

export default function CreateServerForm({ title, t, helper, paidAddons, terraria, initialEdition, settings, billing, legal, plans, addonOptions, defaultPlan, domain, money, initialGame, initialPack, packIcons, cfPacks, cfPicked, curseforge, admin, creator, gift, ai }: Props) {
  const [state, action, pending] = useActionState(createServerAction, {});
  const [testing, setTesting] = useState(false);
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
  const [terrariaKind, setTerrariaKind] = useState<TerrariaKind>(isTerrariaKind(v.terrariaKind) ? v.terrariaKind : "vanilla");
  // What the AI creator picked beyond the form's own fields; sent as hidden fields.
  const [aiSettings, setAiSettings] = useState<Pick<Suggestion, "gameMode" | "difficulty" | "pvp" | "motd" | "plugins"> | null>(null);
  // Bumped by each AI suggestion or helper pick so the plan picker starts from the suggested plan.
  const [aiRound, setAiRound] = useState(0);
  // Controlled so "Pomóż mi zdecydować" can tick them. Crossplay is on unless the owner turned it off before an error sent the form back.
  const [crossplay, setCrossplay] = useState(v.name === undefined || v.crossplay === "on");
  const [nonPremium, setNonPremium] = useState(v.nonPremium === "on");
  const [helperOpen, setHelperOpen] = useState(false);
  const [addons, setAddons] = useState<AddonId[]>(addonList(v.addons?.split(",")));
  const [creatorCode, setCreatorCode] = useState(v.creatorCode ?? creator.code);
  const [freeStarter, setFreeStarter] = useState(v.freeStarter === "on" || (v.name === undefined && creator.freeStarters > 0));
  const [useGift, setUseGift] = useState(!!gift && (v.name === undefined || v.giftCode === gift.code));

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

  function applyHelper(p: HelperPick) {
    setEdition(p.edition);
    if (p.game) setGame(p.game);
    if (p.terrariaKind) setTerrariaKind(p.terrariaKind);
    // A mod pack: keep the chosen one if the plan runs it, otherwise the first that fits.
    if (p.game === "modpack" && !planAtLeast(p.plan, packPlan(pack))) {
      const fits = CURATED_PACKS.find((c) => planAtLeast(p.plan, planForRam(c.ramGb)));
      if (fits) setPack(fits.slug);
    }
    setAddons(p.addons);
    setCrossplay(p.crossplay);
    setNonPremium(p.nonPremium);
    setPlan(p.plan);
    setAiRound((n) => n + 1);
    // So the player sees the form that just filled in, starting with the name it still needs.
    requestAnimationFrame(() => {
      const nameInput = document.querySelector<HTMLInputElement>("#server-form input[name=name]");
      nameInput?.scrollIntoView({ behavior: "smooth", block: "center" });
      nameInput?.focus({ preventScroll: true });
    });
  }
  const modded = edition === "JAVA" && game === "modpack";
  const mods = edition === "JAVA" && game === "mods";
  // On mods, only the loader versions a login mod runs on (see LOGIN_MODS).
  const nonPremiumOffered = mods
    ? canRunNonPremium({ edition: "JAVA", kind: loader, version: modVersion })
    : canRunNonPremium({ edition: "JAVA", kind: gameById(game).kind, version: "LATEST" });
  // Mod packs need a paid plan with enough memory for the pack, so smaller plans can't be picked for them.
  const packPlan = (slug: string) => {
    const gb = pickedCurseforge(slug, cfPacks)?.ramGb ?? CURATED_PACKS.find((p) => p.slug === slug)?.ramGb;
    return gb ? planForRam(gb) : MODPACK_MIN_PLAN;
  };
  // tModLoader needs more memory than the free plan has.
  const tmod = edition === "TERRARIA" && terrariaKind === "tmodloader";
  const minPlan = modded ? packPlan(pack) : tmod ? TMOD_MIN_PLAN : "FREE";
  const planChoices = plans.map((p) =>
    planAtLeast(p.id, minPlan) || p.disabledNote
      ? p
      : { ...p, disabledNote: tmod ? terraria.tmodNoFree : p.id === "FREE" ? t.modpackNoFree : t.packTooSmall },
  );
  const planName = (id: Plan) => plans.find((p) => p.id === id)?.name ?? id;
  // A ready game that's comfortable with more memory than the chosen plan has.
  const wanted = edition === "JAVA" && !modded ? gameById(game).ramGb : 0;
  const ramLow = wanted > planById(plan).ramGb;
  // A free Starter earned with the creator code needs no payment.
  const giftPlan = !!gift && plan === gift.plan;
  const gifted = giftPlan && useGift;
  const rewarded = !gifted && plan === "STARTER" && creator.freeStarters > 0 && freeStarter;
  const paying = plan !== "FREE" && !rewarded && !gifted;
  const c = creator.t;

  return (
    <>
    <div className="new-head">
      <h1>{title}</h1>
      <button
        type="button"
        className={`secondary helper-toggle${helperOpen ? " active" : ""}`}
        aria-expanded={helperOpen}
        aria-controls="pomoc-wybor"
        onClick={() => setHelperOpen((o) => !o)}
      >
        <Lightbulb size={18} aria-hidden /> {helper.button}
      </button>
    </div>
    <PlanHelper
      t={helper}
      server={t}
      terraria={terraria}
      plans={plans}
      addons={addonOptions}
      addonNames={paidAddons.names}
      money={money}
      freeTaken={plans.some((p) => p.id === "FREE" && p.disabledNote)}
      open={helperOpen}
      onClose={() => setHelperOpen(false)}
      onApply={applyHelper}
    />
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
      id="server-form"
      className="card stack"
      // `action` only serves a submit made before the page's script has loaded.
      action={action}
      onSubmit={(e) => {
        // Submitted by hand rather than through `action`, which resets the form after an
        // error and leaves the radio buttons out of step with what's shown.
        e.preventDefault();
        // With the button pressed, so an admin's test button sends its adminTest field.
        const submitter = (e.nativeEvent as SubmitEvent).submitter;
        const data = new FormData(e.currentTarget, submitter);
        setTesting(submitter?.getAttribute("name") === "adminTest");
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
      {edition === "TERRARIA" && (
        <TerrariaFields
          t={terraria}
          values={v}
          kind={terrariaKind}
          onKind={(k) => {
            setTerrariaKind(k);
            if (k === "tmodloader" && !planAtLeast(plan, TMOD_MIN_PLAN)) setPlan(TMOD_MIN_PLAN);
          }}
        />
      )}
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
          cfPacks={cfPacks}
          cfPicked={cfPicked}
          curseforge={curseforge}
          planName={planName}
          locale={money.locale}
          initialLink={v.packLink}
        />
      )}
      {mods && <LoaderFields t={t} loader={loader} version={modVersion} onLoader={setLoader} onVersion={setModVersion} />}
      {edition === "JAVA" && nonPremiumOffered && (
        <label className="check">
          <input type="checkbox" name="nonPremium" checked={nonPremium} onChange={(e) => setNonPremium(e.target.checked)} />
          <span className="stack-tight">
            <span>{settings.nonPremium}</span>
            <span className="muted small">{t.nonPremiumHint}</span>
          </span>
        </label>
      )}
      {mods && !nonPremiumOffered && (
        <p className="muted small">{format(settings.nonPremiumModVersions, { versions: LOGIN_MODS[loader].versions.join(", ") })}</p>
      )}
      {edition === "JAVA" && canCrossplay({ edition, kind: gameById(game).kind }) && (
        <label className="check">
          <input type="checkbox" name="crossplay" checked={crossplay} onChange={(e) => setCrossplay(e.target.checked)} />
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
        // A gift pays for the plan alone; add-ons can be bought later in the panel.
        addons={gifted ? undefined : {
          // The own domain is for Java addresses only.
          options: addonOptions.filter((o) => o.id !== "domain" || edition === "JAVA"),
          initial: addons.filter((a) => a !== "domain" || edition === "JAVA"),
          labels: { title: paidAddons.pickTitle, hint: paidAddons.pickHint, price: paidAddons.price },
          onChange: setAddons,
        }}
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
      {gift && giftPlan && (
        <label className="check creator-reward">
          <input type="checkbox" name="giftCode" value={gift.code} checked={useGift} onChange={(e) => setUseGift(e.target.checked)} />
          <span className="stack-tight">
            <span>{gift.label}</span>
            <span className="muted small">{gift.hint}</span>
          </span>
        </label>
      )}
      {!gifted && plan === "STARTER" && creator.freeStarters > 0 && (
        <label className="check creator-reward">
          <input type="checkbox" name="freeStarter" checked={freeStarter} onChange={(e) => setFreeStarter(e.target.checked)} />
          <span className="stack-tight">
            <span>{format(c.useReward, { days: creator.days })}</span>
            <span className="muted small">{format(c.useRewardHint, { n: creator.freeStarters })}</span>
          </span>
        </label>
      )}
      {paying && (
        <label>
          {c.codeField}
          <input
            name="creatorCode"
            value={creatorCode}
            onChange={(e) => setCreatorCode(e.target.value)}
            maxLength={20}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={c.codePlaceholder}
          />
          <span className="muted small">{format(creatorCode.trim() ? c.codeApplied : c.codeFieldHint, { percent: creator.discount })}</span>
        </label>
      )}
      {paying && (
        <>
          <p className="muted small">{billing.methods}</p>
          <PaymentConsent legal={legal} />
        </>
      )}
      {state.error && <p className="error">{t.errors[state.error]}</p>}
      <button type="submit" disabled={pending}>
        {pending && !testing ? (paying ? billing.redirecting : t.creating) : paying ? t.createAndPay : t.create}
      </button>
      {admin && (
        <>
          <button type="submit" className="secondary" name="adminTest" value="on" disabled={pending}>
            {pending && testing ? t.creating : t.adminTest}
          </button>
          <p className="muted small">{t.adminTestHint}</p>
        </>
      )}
    </form>
    </>
  );
}

/** A Terraria server's type and the world it makes on its first start. */
function TerrariaFields({
  t,
  values,
  kind,
  onKind,
}: {
  t: Messages["terraria"];
  values: Record<string, string>;
  kind: TerrariaKind;
  onKind: (k: TerrariaKind) => void;
}) {
  return (
    <>
      <fieldset className="stack">
        <legend>{t.kind}</legend>
        <div className="plan-options">
          {TERRARIA_KINDS.map((k) => (
            <label key={k} className="choice plan-choice">
              <input type="radio" name="terrariaKind" value={k} checked={kind === k} onChange={() => onKind(k)} />
              <span className="stack-tight">
                <strong>{t.kinds[k]}</strong>
                <span className="muted small">{t.kindHints[k]}</span>
                {k === "tmodloader" && <span className="ram-pill">{t.tmodPlan}</span>}
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
