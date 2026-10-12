"use client";

import { useState, useTransition } from "react";
import { Check, Plus, RotateCw, Trash2 } from "lucide-react";
import { addPluginAction, addPluginSetAction, applyPluginsAction, removePluginAction, type PluginResult } from "./actions";
import type { Messages } from "@/i18n/messages";
import { format } from "@/i18n/messages";

type T = Messages["plugins"];

// Saving says whether the server picks the change up when it next starts (it was off) or once it's restarted.
function useSave(t: T) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const save = (action: () => Promise<PluginResult>) =>
    startTransition(async () => {
      const res = await action();
      if (res.error) setMessage({ text: t.errors[res.error], error: true });
      else setMessage({ text: res.pending ? t.savedRunning : t.savedOffline, error: false });
    });
  return { pending, message, save };
}

function Message({ message }: { message: { text: string; error: boolean } | null }) {
  return message && <span className={message.error ? "error small" : "muted small"}>{message.text}</span>;
}

export function AddPluginButton({ id, pluginId, added, t }: { id: string; pluginId: string; added: boolean; t: T }) {
  const { pending, message, save } = useSave(t);
  return (
    <span className="plugin-action">
      <button className="secondary small" disabled={added || pending} onClick={() => save(() => addPluginAction(id, pluginId))}>
        {added ? <Check size={15} aria-hidden /> : <Plus size={15} aria-hidden />} {added ? t.added : t.install}
      </button>
      <Message message={message} />
    </span>
  );
}

export function AddSetButton({ id, setId, added, t }: { id: string; setId: string; added: boolean; t: T }) {
  const { pending, message, save } = useSave(t);
  return (
    <span className="plugin-action">
      <button className="secondary small" disabled={added || pending} onClick={() => save(() => addPluginSetAction(id, setId))}>
        {added ? <Check size={15} aria-hidden /> : <Plus size={15} aria-hidden />} {added ? t.setAdded : t.addSet}
      </button>
      <Message message={message} />
    </span>
  );
}

export function RemovePluginButton({ id, pluginId, title, t }: { id: string; pluginId: string; title: string; t: T }) {
  const { pending, message, save } = useSave(t);
  return (
    <span className="plugin-action">
      <button
        className="secondary small"
        disabled={pending}
        onClick={() => {
          if (confirm(format(t.removeConfirm, { title }))) save(() => removePluginAction(id, pluginId));
        }}
      >
        <Trash2 size={15} aria-hidden /> {t.remove}
      </button>
      <Message message={message} />
    </span>
  );
}

/** Shown while the running server still has the old plugins, and once it's restarting with the new ones. */
export function ApplyPlugins({ id, pending: changed, t }: { id: string; pending: boolean; t: T }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<PluginResult | null>(null);
  if (!changed) return result && !result.error ? <p className="notice success">{t.applied}</p> : null;
  return (
    <div className="notice row">
      <span>{t.pending}</span>
      <button className="small" disabled={pending} onClick={() => startTransition(async () => setResult(await applyPluginsAction(id)))}>
        <RotateCw size={15} aria-hidden /> {pending ? t.applying : t.apply}
      </button>
      {result?.error && <span className="error small">{t.errors[result.error]}</span>}
    </div>
  );
}
