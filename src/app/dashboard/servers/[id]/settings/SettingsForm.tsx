"use client";

import { startTransition, useActionState, useState } from "react";
import type { Edition } from "@prisma/client";
import { saveSettingsAction } from "../../actions";
import { DIFFICULTIES, GAME_MODES, MOTD_MAX, isDowngrade } from "@/lib/settings";
import type { Messages } from "@/i18n/messages";

type Props = {
  serverId: string;
  edition: Edition;
  name: string;
  versions: string[];
  versionNote?: string; // shown instead of the version picker when the version isn't up to the owner
  versionHint?: string; // replaces the usual hint under the version picker
  nonPremium?: { offered: boolean; on: boolean }; // Java only; offered on Paper servers
  initial: {
    version: string;
    gameMode: string;
    difficulty: string;
    motd: string;
    pvp: boolean;
    whitelist: boolean;
    players: string;
  };
  t: Messages["settings"];
};

export default function SettingsForm({ serverId, edition, name, versions, versionNote, versionHint, nonPremium, initial, t }: Props) {
  const [state, action, pending] = useActionState(saveSettingsAction.bind(null, serverId), {});
  const [version, setVersion] = useState(initial.version);
  const [whitelist, setWhitelist] = useState(initial.whitelist);
  const java = edition === "JAVA";
  const label = (v: string) => (v === "LATEST" ? t.latest : v);

  return (
    <form
      className="card stack"
      // `action` only serves a submit made before the page's script has loaded.
      action={action}
      onSubmit={(e) => {
        // Submitted by hand rather than through `action`, which would reset every field after an error.
        e.preventDefault();
        if (isDowngrade(initial.version, version) && !confirm(t.downgradeConfirm.replace("{version}", label(version)))) {
          return;
        }
        const data = new FormData(e.currentTarget);
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
          <select name="version" value={version} onChange={(e) => setVersion(e.target.value)}>
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
      {java && (
        <label className="check">
          <input type="checkbox" name="pvp" defaultChecked={initial.pvp} />
          <span>{t.pvp}</span>
        </label>
      )}
      {nonPremium?.offered && (
        <label className="check">
          <input type="checkbox" name="nonPremium" defaultChecked={nonPremium.on} />
          <span className="stack-tight">
            <span>{t.nonPremium}</span>
            <span className="muted small">{t.nonPremiumHint}</span>
          </span>
        </label>
      )}
      {nonPremium && !nonPremium.offered && <p className="muted small">{t.nonPremiumPaperOnly}</p>}
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
  );
}
