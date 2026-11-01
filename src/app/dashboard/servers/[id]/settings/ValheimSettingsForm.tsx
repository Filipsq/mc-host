"use client";

import { startTransition, useActionState } from "react";
import { saveValheimSettingsAction } from "../../actions";
import { VALHEIM_PASSWORD_MAX, VALHEIM_PRESETS, isValheimPreset } from "@/lib/otherGames";
import type { Messages } from "@/i18n/messages";

type Props = {
  serverId: string;
  initial: { password: string; preset: string };
  t: Messages["settings"];
  valheim: Messages["otherGames"]["valheim"];
};

/** A Valheim server's password and difficulty preset. */
export default function ValheimSettingsForm({ serverId, initial, t, valheim }: Props) {
  const [state, action, pending] = useActionState(saveValheimSettingsAction.bind(null, serverId), {});
  return (
    <form
      className="card stack"
      // `action` only serves a submit made before the page's script has loaded.
      action={action}
      onSubmit={(e) => {
        // Submitted by hand rather than through `action`, which would reset every field after an error.
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <label>
        {valheim.password}
        <input
          name="password"
          required
          minLength={5}
          maxLength={VALHEIM_PASSWORD_MAX}
          pattern="[A-Za-z0-9]{5,20}"
          defaultValue={initial.password}
          autoComplete="off"
          spellCheck={false}
        />
        <span className="muted small">{valheim.passwordHint}</span>
      </label>
      <label>
        {valheim.preset}
        <select name="preset" defaultValue={isValheimPreset(initial.preset) ? initial.preset : "normal"}>
          {VALHEIM_PRESETS.map((p) => (
            <option key={p} value={p}>
              {valheim.presets[p]}
            </option>
          ))}
        </select>
        <span className="muted small">{valheim.presetHint}</span>
      </label>
      <p className="muted small">{valheim.adminHint}</p>
      <p className="muted small">{t.restartNote}</p>
      {state.error && <p className="error">{t.errors[state.error].replace("{player}", "")}</p>}
      <button type="submit" disabled={pending}>
        {pending ? t.saving : t.save}
      </button>
    </form>
  );
}
