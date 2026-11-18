"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import { Play } from "lucide-react";
import { restartCrashedAction, type RestartResult } from "./actions";
import type { Messages } from "@/i18n/messages";

type T = Messages["admin"]["restartCrashed"];
type Ctx = { t: T; results: Record<string, RestartResult>; busy: string[]; restart: (ids: string[]) => void };
const RestartContext = createContext<Ctx | null>(null);

/** Holds what the restart buttons in "Wymaga uwagi" did, so the one for all and the ones per server share it. */
export function RestartCrashedProvider({ t, children }: { t: T; children: ReactNode }) {
  const [results, setResults] = useState<Record<string, RestartResult>>({});
  const [busy, setBusy] = useState<string[]>([]);
  const [, startTransition] = useTransition();
  const restart = (ids: string[]) => {
    setBusy((b) => [...b, ...ids]);
    startTransition(async () => {
      const done = await restartCrashedAction(ids).catch(() => Object.fromEntries(ids.map((id) => [id, "failed" as const])));
      setResults((r) => ({ ...r, ...done }));
      setBusy((b) => b.filter((id) => !ids.includes(id)));
    });
  };
  return <RestartContext.Provider value={{ t, results, busy, restart }}>{children}</RestartContext.Provider>;
}

/** "Uruchom wszystkie awarie": starts every crashed server in the list not started yet. */
export function RestartAllCrashed({ ids }: { ids: string[] }) {
  const c = useContext(RestartContext)!;
  const left = ids.filter((id) => !c.results[id] || c.results[id] === "failed");
  const working = ids.some((id) => c.busy.includes(id));
  return (
    <button type="button" className="secondary small" disabled={working || left.length === 0} onClick={() => c.restart(left)}>
      <Play size={14} aria-hidden /> {working ? c.t.working : `${c.t.all} (${left.length})`}
    </button>
  );
}

/** One crashed server's start button, or what its start did. */
export function RestartCrashed({ id }: { id: string }) {
  const c = useContext(RestartContext)!;
  const result = c.results[id];
  if (c.busy.includes(id)) return <span className="muted small">{c.t.working}</span>;
  if (result && result !== "failed") return <span className="muted small">{c.t.results[result]}</span>;
  return (
    <span>
      {result === "failed" && (
        <span className="small" style={{ color: "var(--error)" }}>
          {c.t.results.failed}{" "}
        </span>
      )}
      <button type="button" className="secondary small" onClick={() => c.restart([id])}>
        <Play size={14} aria-hidden /> {c.t.one}
      </button>
    </span>
  );
}
