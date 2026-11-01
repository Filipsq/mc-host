"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { saveLinksAction } from "./actions";
import type { Messages } from "@/i18n/messages";

type Item = { id: string; name: string; address: string; ok: boolean; checked: boolean; elsewhere: boolean };
type Props = { serverId: string; servers: Item[]; max: number; t: Messages["links"] };

function Save({ t }: { t: Messages["links"] }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending}>{pending ? t.saving : t.save}</button>;
}

/** The owner's other Java servers, ticked when linked with this one. */
export default function LinksForm({ serverId, servers, max, t }: Props) {
  const [picked, setPicked] = useState(() => new Set(servers.filter((s) => s.checked).map((s) => s.id)));
  const toggle = (id: string, on: boolean) => {
    const next = new Set(picked);
    if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
  };
  return (
    <form action={saveLinksAction.bind(null, serverId)} className="card stack">
      <p>{t.pick}</p>
      {servers.map((s) => (
        <label key={s.id} className="check">
          <input
            type="checkbox"
            name="server"
            value={s.id}
            disabled={!s.ok || (!picked.has(s.id) && picked.size >= max)}
            checked={picked.has(s.id)}
            onChange={(e) => toggle(s.id, e.target.checked)}
          />
          <span className="stack-tight">
            <span>{s.name}</span>
            <span className="muted small">
              {s.address}
              {!s.ok && ` · ${t.serverTooOld}`}
              {s.ok && s.elsewhere && ` · ${t.elsewhere}`}
            </span>
          </span>
        </label>
      ))}
      <p className="notice warn small">{t.restartNote}</p>
      <div className="row">
        <Save t={t} />
      </div>
    </form>
  );
}
