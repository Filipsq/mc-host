"use client";

import { startTransition, useActionState, useState } from "react";
import { Scissors } from "lucide-react";
import { format, type Messages } from "@/i18n/messages";
import { trimWorldAction, type WorldError } from "../actions";

type Cut = { radius: number; label: string; frees: string; bytes: number };

export function TrimForm({
  id,
  world,
  x,
  z,
  cuts,
  backups,
  disabled,
  t,
  errors,
  files,
}: {
  id: string;
  world: string;
  x: number;
  z: number;
  cuts: Cut[];
  backups: boolean;
  disabled: boolean;
  t: Messages["worlds"]["trim"];
  errors: Messages["worlds"]["errors"];
  files: Messages["files"]["errors"];
}) {
  const [state, action, pending] = useActionState(trimWorldAction.bind(null, id), {});
  const v = state.values ?? {};
  // The biggest distance that still frees something: the gentlest cut that helps.
  const suggested = [...cuts].reverse().find((c) => c.bytes > 0)?.radius;
  const [choice, setChoice] = useState(v.radius ?? (suggested ? String(suggested) : "custom"));
  const [custom, setCustom] = useState(v.customRadius ?? "");
  const shownRadius = choice === "custom" ? Number(custom.replace(/[\s.,]/g, "")) || 0 : Number(choice);
  const error = state.error as WorldError | undefined;
  return (
    <form
      className="stack"
      action={action}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <input type="hidden" name="world" value={world} />
      <input type="hidden" name="x" value={x} />
      <input type="hidden" name="z" value={z} />
      <fieldset className="trim-cuts">
        <legend>
          <strong>{t.keepTitle}</strong>
        </legend>
        {cuts.map((c) => (
          <label key={c.radius}>
            <input type="radio" name="radius" value={c.radius} checked={choice === String(c.radius)} onChange={() => setChoice(String(c.radius))} />
            <span>{c.label}</span>
            <span className={c.bytes > 0 ? "chip small-chip" : "muted small"}>{c.frees}</span>
          </label>
        ))}
        <label>
          <input type="radio" name="radius" value="custom" checked={choice === "custom"} onChange={() => setChoice("custom")} />
          <span>{t.custom}</span>
          <input
            name="customRadius"
            inputMode="numeric"
            value={custom}
            onChange={(e) => {
              setCustom(e.target.value);
              setChoice("custom");
            }}
            placeholder="15000"
            aria-label={t.custom}
          />
        </label>
        <span className="muted small">
          {format(t.customHint, { r: shownRadius >= 1000 ? new Intl.NumberFormat().format(shownRadius) : "R" })} {t.sameEverywhere}
        </span>
      </fieldset>
      {backups ? (
        <label className="check">
          <input type="checkbox" name="backup" defaultChecked={v.backup !== undefined ? v.backup === "on" : true} /> {t.backup}
        </label>
      ) : (
        <p className="muted small">{t.noBackups}</p>
      )}
      <label className="check">
        <input type="checkbox" name="confirm" required defaultChecked={v.confirm === "on"} /> {t.confirm}
      </label>
      {error && <p className="error">{(errors as Record<string, string>)[error] ?? (files as Record<string, string>)[error] ?? files.failed}</p>}
      <div>
        <button type="submit" className="danger" disabled={pending || disabled}>
          <Scissors size={16} aria-hidden /> {pending ? t.working : t.button}
        </button>
      </div>
    </form>
  );
}
