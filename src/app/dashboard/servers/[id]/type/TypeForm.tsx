"use client";

import { startTransition, useActionState, useState } from "react";
import Link from "next/link";
import type { Plan } from "@prisma/client";
import { format, type Messages } from "@/i18n/messages";
import { CURATED_PACKS, LOADER_NAMES, isModLoader, planAtLeast, type ModLoader } from "@/lib/modpacks";
import { MOD_DEFAULT_VERSION } from "@/lib/settings";
import { SERVER_TYPES, minPlanFor, ramFor, typeGame, type ServerType } from "@/lib/serverType";
import { LoaderFields, PackFields } from "@/app/dashboard/new/ModFields";
import { changeTypeAction } from "./actions";

type Props = {
  id: string;
  current: { type: ServerType; loader?: string; version: string; pack?: string };
  plan: Plan;
  planNames: Record<Plan, string>;
  planRam: Record<Plan, number>;
  packIcons: Record<string, string | undefined>;
  locale: string;
  notes: { backup: boolean; modsMoved: boolean; plugins: boolean };
  curseforge: boolean; // whether CurseForge links work
  t: Messages["serverType"];
  server: Messages["server"];
};

export default function TypeForm({ id, current, plan, planNames, planRam, packIcons, locale, notes, curseforge, t, server }: Props) {
  const [state, action, pending] = useActionState(changeTypeAction.bind(null, id), {});
  const v = state.values ?? {};
  // Starts on something other than what the server runs, since that's what the page is for.
  const [type, setType] = useState<ServerType>(
    (v.type as ServerType | undefined) ?? (current.type === "mods" ? "modpack" : "mods"),
  );
  const [loader, setLoader] = useState<ModLoader>(isModLoader(v.loader) ? v.loader : isModLoader(current.loader) ? current.loader : "fabric");
  const [modVersion, setModVersion] = useState(v.modVersion ?? (current.type === "mods" ? current.version : MOD_DEFAULT_VERSION));
  const [pack, setPack] = useState(v.pack ?? CURATED_PACKS[0].slug);

  const curated = CURATED_PACKS.find((p) => p.slug === pack);
  const minPlan = minPlanFor(type, pack);
  const tooSmall = !planAtLeast(plan, minPlan);
  const wanted = ramFor(type, pack);
  const ramLow = !tooSmall && wanted > planRam[plan];
  const name =
    type === "mods" ? LOADER_NAMES[loader] : type === "modpack" ? (curated?.title ?? server.packOther) : server.games[typeGame(type).id];

  return (
    <form
      className="card stack"
      // `action` only serves a submit made before the page's script has loaded.
      action={action}
      onSubmit={(e) => {
        // Submitted by hand rather than through `action`, which would reset the choices after an error.
        e.preventDefault();
        if (!confirm(format(t.confirm, { type: name }))) return;
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <fieldset className="stack">
        <legend>{t.type}</legend>
        <div className="plan-options">
          {SERVER_TYPES.map((st) => {
            const game = typeGame(st);
            return (
              <label key={st} className="choice plan-choice">
                <input type="radio" name="type" value={st} checked={type === st} onChange={() => setType(st)} />
                <span className="stack-tight">
                  <span>
                    <strong>{st === "vanilla" ? server.kinds.vanilla : server.games[game.id]}</strong>{" "}
                    {st === current.type && <span className="chip small-chip">{t.current}</span>}
                  </span>
                  <span className="muted small">{st === "vanilla" ? server.kindHints.vanilla : server.gameHints[game.id]}</span>
                  <span className="ram-pill">{format(server.ramFrom, { gb: game.ramGb })}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {type === "mods" && <LoaderFields t={server} loader={loader} version={modVersion} onLoader={setLoader} onVersion={setModVersion} />}
      {type === "modpack" && (
        <PackFields
          t={server}
          pack={pack}
          onPack={setPack}
          packIcons={packIcons}
          planName={(p) => planNames[p]}
          locale={locale}
          initialLink={v.packLink}
          curseforge={curseforge}
        />
      )}

      {tooSmall ? (
        <div className="notice warn row">
          <span>{format(t.needsPlan, { type: name, plan: planNames[minPlan], gb: planRam[minPlan], current: planNames[plan] })}</span>
          <Link className="button small" href={`/dashboard/servers/${id}/billing`}>
            {t.changePlan}
          </Link>
        </div>
      ) : (
        ramLow && <p className="notice warn">{format(server.ramLow, { game: name, gb: wanted, plan: planRam[plan] })}</p>
      )}
      <ul className="muted small type-notes">
        {notes.backup && <li>{t.backupNote}</li>}
        {notes.modsMoved && <li>{t.modsMoved}</li>}
        {notes.plugins && type !== "vanilla" && type !== "skymap" && type !== "skyblock" && type !== "oneblock" && <li>{t.pluginsDropped}</li>}
      </ul>
      {state.error && <p className="error">{(t.errors as Record<string, string>)[state.error] ?? (server.errors as Record<string, string>)[state.error] ?? t.errors.failed}</p>}
      <button type="submit" disabled={pending || tooSmall}>
        {pending ? t.submitting : t.submit}
      </button>
    </form>
  );
}
