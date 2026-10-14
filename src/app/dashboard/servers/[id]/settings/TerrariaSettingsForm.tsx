"use client";

import { startTransition, useActionState } from "react";
import { saveTerrariaSettingsAction } from "../../actions";
import { MOTD_MAX } from "@/lib/settings";
import { SERVER_PASSWORD_MAX } from "@/lib/terraria";
import type { Messages } from "@/i18n/messages";

type Props = {
  serverId: string;
  name: string;
  world: string; // the world's size and difficulty, already worded
  initial: { motd: string; password: string };
  t: Messages["settings"];
  terraria: Messages["terraria"];
};

export default function TerrariaSettingsForm({ serverId, name, world, initial, t, terraria }: Props) {
  const [state, action, pending] = useActionState(saveTerrariaSettingsAction.bind(null, serverId), {});
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
      <div className="stack-tight">
        <span>{world}</span>
        <span className="muted small">{terraria.worldOnce}</span>
      </div>
      <label>
        {t.motd}
        <input name="motd" defaultValue={initial.motd} maxLength={MOTD_MAX} placeholder={name} />
        <span className="muted small">{t.motdHint}</span>
      </label>
      <label>
        {terraria.password}
        <input name="password" defaultValue={initial.password} maxLength={SERVER_PASSWORD_MAX} autoComplete="off" spellCheck={false} />
        <span className="muted small">{terraria.passwordHint}</span>
      </label>
      <p className="muted small">{t.restartNote}</p>
      {state.error && <p className="error">{t.errors[state.error].replace("{player}", "")}</p>}
      <button type="submit" disabled={pending}>
        {pending ? t.saving : t.save}
      </button>
    </form>
  );
}
