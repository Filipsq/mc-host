"use client";

import { useEffect, useState } from "react";
import type { LiveState } from "@/lib/servers";

export type ServerActionKind = "start" | "stop" | "restart" | "failed";
/** Sent by the Start/Stop/Restart buttons the moment they are clicked. */
export const SERVER_ACTION_EVENT = "server-action";

/**
 * The server's state badge. A click on Start, Stop or Restart changes it at
 * once ("Uruchamianie", "Zatrzymywanie", "Restartowanie"); the real state from
 * the game machine takes over as soon as the page has it.
 */
export default function LiveBadge({ id, live, labels, stopping }: { id: string; live: LiveState; labels: Record<LiveState, string>; stopping: string }) {
  const [guess, setGuess] = useState<{ cls: string; label: string } | null>(null);

  useEffect(() => {
    const on = (e: Event) => {
      const { id: target, kind } = (e as CustomEvent<{ id: string; kind: ServerActionKind }>).detail;
      if (target !== id) return;
      if (kind === "failed") return setGuess(null); // the action was refused: back to the real state
      setGuess(
        kind === "start" ? { cls: "starting", label: labels.starting } : kind === "restart" ? { cls: "restarting", label: labels.restarting } : { cls: "starting", label: stopping },
      );
    };
    window.addEventListener(SERVER_ACTION_EVENT, on);
    return () => window.removeEventListener(SERVER_ACTION_EVENT, on);
  }, [id, labels, stopping]);

  // A new real state arrived: show that. And never keep a guess for long.
  useEffect(() => setGuess(null), [live]);
  useEffect(() => {
    if (!guess) return;
    const timer = setTimeout(() => setGuess(null), 30_000);
    return () => clearTimeout(timer);
  }, [guess]);

  return <span className={`badge ${guess?.cls ?? live}`}>{guess?.label ?? labels[live]}</span>;
}
