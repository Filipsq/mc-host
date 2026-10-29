"use client";

import { useActionState, useTransition, useState } from "react";
import { removePackAction, savePackAction, type PackState } from "./actions";
import { PACK_PROMPT_MAX } from "@/lib/settings";
import type { Messages } from "@/i18n/messages";

type Props = {
  serverId: string;
  initial: { url: string; required: boolean; prompt: string };
  running: boolean; // saving restarts it
  t: Messages["resourcePack"];
};

export default function PackForm({ serverId, initial, running, t }: Props) {
  const [state, action, pending] = useActionState(savePackAction.bind(null, serverId), {});
  const [removed, setRemoved] = useState<PackState>({});
  const [removing, startRemove] = useTransition();
  const has = initial.url !== "" && !removed.removed;
  const result = removed.removed || removed.error ? removed : state;

  return (
    <form action={action} className="card stack">
      <label>
        {t.url}
        <input name="url" type="url" required placeholder="https://www.dropbox.com/…/paczka.zip?dl=1" defaultValue={has ? initial.url : ""} />
        <span className="muted small">{t.urlHint}</span>
      </label>
      <label className="check">
        <input name="required" type="checkbox" defaultChecked={has && initial.required} />
        <span className="stack-tight">
          <span>{t.required}</span>
          <span className="muted small">{t.requiredHint}</span>
        </span>
      </label>
      <label>
        {t.prompt}
        <input name="prompt" maxLength={PACK_PROMPT_MAX} placeholder={t.promptPlaceholder} defaultValue={has ? initial.prompt : ""} />
        <span className="muted small">{t.promptHint}</span>
      </label>
      {running && <p className="notice warn small">{t.restartNote}</p>}
      {pending && <p className="muted small">{t.checking}</p>}
      {result.saved && <p className="notice small">{t.saved}</p>}
      {result.removed && <p className="notice small">{t.removed}</p>}
      {result.error && <p className="error">{t.errors[result.error]}</p>}
      <div className="row">
        <button type="submit" disabled={pending || removing}>
          {pending ? t.checking : t.save}
        </button>
        {has && (
          <button
            type="button"
            className="secondary"
            disabled={pending || removing}
            onClick={() => startRemove(async () => setRemoved(await removePackAction(serverId)))}
          >
            {t.remove}
          </button>
        )}
      </div>
    </form>
  );
}
