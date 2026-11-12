"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import type { Edition } from "@prisma/client";
import { saveSettingsAction } from "../../actions";
import { DIFFICULTIES, GAME_MODES, MOTD_MAX, SPAWN_PROTECTION_MAX, VIEW_DISTANCE_MIN } from "@/lib/settings";
import { format, type Messages } from "@/i18n/messages";

type Props = {
  /** How "Najnowsza" reads in the picker, with its number when known: "Najnowsza (26.1.2)". */
  latestLabel?: string;
  serverId: string;
  edition: Edition;
  name: string;
  versions: string[];
  versionNote?: string; // shown instead of the version picker when the version isn't up to the owner
  versionHint?: string; // replaces the usual hint under the version picker
  playerLimit: number; // the most the plan allows
  viewDistance: { max: number; def: number }; // the plan's range and default, in chunks
  // Java only; offered on Paper servers, and on mod loaders only on the versions their login mod runs on
  nonPremium?: { offered: boolean; on: boolean; ownLogin?: boolean; versions?: readonly string[] };
  crossplay?: { offered: boolean; on: boolean; host: string; port: number }; // the same, with where Bedrock players join
  initial: {
    version: string;
    gameMode: string;
    difficulty: string;
    motd: string;
    pvp: boolean;
    maxPlayers: number;
    allowFlight: boolean;
    hardcore: boolean;
    commandBlocks: boolean;
    allowNether: boolean;
    allowEnd: boolean;
    forceGamemode: boolean;
    spawnMonsters: boolean;
    spawnProtection: number;
    viewDistance: number;
    whitelist: boolean;
    players: string;
  };
  t: Messages["settings"];
};

export default function SettingsForm({ serverId, edition, name, versions, latestLabel, versionNote, versionHint, playerLimit, viewDistance, nonPremium, crossplay, initial, t }: Props) {
  const [state, action, pending] = useActionState(saveSettingsAction.bind(null, serverId), {});
  const [version, setVersion] = useState(initial.version);
  // A version picked in the picker, waiting for the owner to agree to a new world on it.
  const [asked, setAsked] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [whitelist, setWhitelist] = useState(initial.whitelist);
  const [nonPremiumOn, setNonPremiumOn] = useState(nonPremium?.on ?? false);
  const [view, setView] = useState(initial.viewDistance);
  const java = edition === "JAVA";
  const nonPremiumOffered = nonPremium?.versions ? nonPremium.versions.includes(version) : nonPremium?.offered;
  const label = (v: string) => (v === "LATEST" ? (latestLabel ?? t.latest) : v);

  // Another version starts a new world on it (the old one stays under Worlds), so the owner
  // agrees first; agreeing saves the form at once with the new version.
  const agree = () => {
    if (!asked || !formRef.current) return;
    const data = new FormData(formRef.current);
    data.set("version", asked);
    data.set("newWorld", "on");
    setVersion(asked);
    setAsked(null);
    startTransition(() => action(data));
  };

  useEffect(() => {
    if (!asked) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setAsked(null);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [asked]);

  return (
    <>
      <form
        ref={formRef}
        className="card stack"
        // `action` only serves a submit made before the page's script has loaded.
        action={action}
        onSubmit={(e) => {
          // Submitted by hand rather than through `action`, which would reset every field after an error.
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          // A version agreed to in the popup whose save failed: saving again still makes the new world.
          if (data.get("version") !== initial.version) data.set("newWorld", "on");
          startTransition(() => action(data));
        }}
      >
        {java && versionNote && (
          <div className="stack-tight">
            <span>{t.version}</span>
            <span className="muted small">{versionNote}</span>
          </div>
        )}
        {java && !versionNote && (
          <label>
            {t.version}
            <select name="version" value={version} onChange={(e) => e.target.value !== version && setAsked(e.target.value)}>
              {versions.map((v) => (
                <option key={v} value={v}>
                  {label(v)}
                </option>
              ))}
            </select>
            <span className="muted small">{versionHint ?? t.versionHint}</span>
          </label>
        )}
        <fieldset className="stack">
          <legend>{t.gameMode}</legend>
          <div className="option-row">
            {GAME_MODES.map((m) => (
              <label key={m} className="choice">
                <input type="radio" name="gameMode" value={m} defaultChecked={initial.gameMode === m} />
                <span>{t.modes[m]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          {t.difficulty}
          <select name="difficulty" defaultValue={initial.difficulty}>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {t.difficulties[d]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.motd}
          <input name="motd" defaultValue={initial.motd} maxLength={MOTD_MAX} placeholder={name} />
          <span className="muted small">{t.motdHint}</span>
        </label>
        <label>
          {t.maxPlayers}
          <input name="maxPlayers" type="number" min={1} max={playerLimit} required defaultValue={initial.maxPlayers} />
          <span className="muted small">{format(t.maxPlayersHint, { n: playerLimit })}</span>
        </label>
        {java && (
          <label className="check">
            <input type="checkbox" name="pvp" defaultChecked={initial.pvp} />
            <span>{t.pvp}</span>
          </label>
        )}
        {java && (
          <>
            <label className="check">
              <input type="checkbox" name="allowFlight" defaultChecked={initial.allowFlight} />
              <span className="stack-tight">
                <span>{t.allowFlight}</span>
                <span className="muted small">{t.allowFlightHint}</span>
              </span>
            </label>
            <label className="check">
              <input type="checkbox" name="hardcore" defaultChecked={initial.hardcore} />
              <span className="stack-tight">
                <span>{t.hardcore}</span>
                <span className="muted small">{t.hardcoreHint}</span>
              </span>
            </label>
            <label className="check">
              <input type="checkbox" name="commandBlocks" defaultChecked={initial.commandBlocks} />
              <span>{t.commandBlocks}</span>
            </label>
            <label className="check">
              <input type="checkbox" name="allowNether" defaultChecked={initial.allowNether} />
              <span className="stack-tight">
                <span>{t.allowNether}</span>
                <span className="muted small">{t.allowNetherHint}</span>
              </span>
            </label>
            <label className="check">
              <input type="checkbox" name="allowEnd" defaultChecked={initial.allowEnd} />
              <span className="stack-tight">
                <span>{t.allowEnd}</span>
                <span className="muted small">{t.allowEndHint}</span>
              </span>
            </label>
            <label className="check">
              <input type="checkbox" name="spawnMonsters" defaultChecked={initial.spawnMonsters} />
              <span className="stack-tight">
                <span>{t.spawnMonsters}</span>
                <span className="muted small">{t.spawnMonstersHint}</span>
              </span>
            </label>
            <label className="check">
              <input type="checkbox" name="forceGamemode" defaultChecked={initial.forceGamemode} />
              <span className="stack-tight">
                <span>{t.forceGamemode}</span>
                <span className="muted small">{t.forceGamemodeHint}</span>
              </span>
            </label>
            <label>
              {t.spawnProtection}
              <input name="spawnProtection" type="number" min={0} max={SPAWN_PROTECTION_MAX} required defaultValue={initial.spawnProtection} />
              <span className="muted small">{t.spawnProtectionHint}</span>
            </label>
            <label>
              <span>
                {t.viewDistance}: <strong>{view}</strong>
              </span>
              <input name="viewDistance" type="range" min={VIEW_DISTANCE_MIN} max={viewDistance.max} step={1} value={view} onChange={(e) => setView(Number(e.target.value))} />
              <span className="muted small">{format(t.viewDistanceHint, { min: VIEW_DISTANCE_MIN, max: viewDistance.max, def: viewDistance.def })}</span>
              {view > 12 && <span className="notice warn small">{t.viewDistanceHigh}</span>}
            </label>
          </>
        )}
        {nonPremium && nonPremiumOffered && (
          <label className="check">
            <input type="checkbox" name="nonPremium" checked={nonPremiumOn} onChange={(e) => setNonPremiumOn(e.target.checked)} />
            <span className="stack-tight">
              <span>{t.nonPremium}</span>
              <span className="muted small">{t.nonPremiumHint}</span>
            </span>
          </label>
        )}
        {nonPremium && nonPremiumOffered && nonPremiumOn && (
          <label className="check">
            <input type="checkbox" name="ownLogin" defaultChecked={nonPremium.ownLogin} />
            <span className="stack-tight">
              <span>{t.ownLogin}</span>
              <span className="muted small">{t.ownLoginHint}</span>
            </span>
          </label>
        )}
        {nonPremium && !nonPremiumOffered && (
          <p className="muted small">
            {nonPremium.versions?.length
              ? format(t.nonPremiumModVersions, { versions: nonPremium.versions.join(", ") })
              : t.nonPremiumPaperOnly}
          </p>
        )}
        {crossplay?.offered && (
          <label className="check">
            <input type="checkbox" name="crossplay" defaultChecked={crossplay.on} />
            <span className="stack-tight">
              <span>{t.crossplay}</span>
              <span className="muted small">{format(t.crossplayHint, { host: crossplay.host, port: crossplay.port })}</span>
            </span>
          </label>
        )}
        {crossplay && !crossplay.offered && <p className="muted small">{t.crossplayPaperOnly}</p>}
        <label className="check">
          <input type="checkbox" name="whitelist" checked={whitelist} onChange={(e) => setWhitelist(e.target.checked)} />
          <span>{t.whitelist}</span>
        </label>
        {/* Kept in the form while hidden, so turning the list off and on again keeps the names. */}
        <label hidden={!whitelist}>
          {t.players}
          <textarea name="players" defaultValue={initial.players} rows={5} spellCheck={false} />
          <span className="muted small">{java ? t.playersHintJava : t.playersHintBedrock}</span>
        </label>
        <p className="muted small">{t.opHint}</p>
        <p className="muted small">{t.restartNote}</p>
        {state.error && <p className="error">{t.errors[state.error].replace("{player}", state.player ?? "")}</p>}
        <button type="submit" disabled={pending}>
          {pending ? t.saving : t.save}
        </button>
      </form>
      {asked && (
        <div className="modal-backdrop" onClick={() => setAsked(null)}>
          <div className="card stack modal" role="dialog" aria-modal="true" aria-labelledby="new-world-title" onClick={(e) => e.stopPropagation()}>
            <h3 id="new-world-title">{format(t.newWorldTitle, { version: label(asked) })}</h3>
            <p>{format(t.newWorldText, { version: label(asked) })}</p>
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setAsked(null)}>
                {t.newWorldCancel}
              </button>
              <button type="button" onClick={agree} autoFocus>
                {t.newWorldConfirm}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
