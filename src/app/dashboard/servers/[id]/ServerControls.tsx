"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Play, RotateCw, Square } from "lucide-react";
import { restartServerAction, startServerAction, stopServerAction } from "../actions";
import type { LiveState } from "@/lib/servers";
import { SERVER_ACTION_EVENT } from "./LiveBadge";
import type { Messages } from "@/i18n/messages";

type Props = { id: string; live: LiveState; t: Messages["server"] };

/** Start, or Restart and Stop, at the top of every page of the server's panel. */
export default function ServerControls({ id, live, t }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Which button was clicked: it says what is happening at once, before the server answers.
  const [doing, setDoing] = useState<"start" | "stop" | "restart" | null>(null);
  const running = live === "online" || live === "starting" || live === "restarting";

  function run(kind: "start" | "stop" | "restart", action: (id: string) => Promise<{ error?: keyof Messages["server"]["errors"] } | void>) {
    setDoing(kind);
    // The state badge changes right away (LiveBadge); the real state follows.
    window.dispatchEvent(new CustomEvent(SERVER_ACTION_EVENT, { detail: { id, kind } }));
    startTransition(async () => {
      const result = await action(id);
      setError(result?.error ? t.errors[result.error] : null);
      if (result?.error) window.dispatchEvent(new CustomEvent(SERVER_ACTION_EVENT, { detail: { id, kind: "failed" } }));
      router.refresh();
    });
  }
  const busy = (kind: "start" | "stop" | "restart") => pending && doing === kind;
  const spinner = <Loader2 size={16} className="spin" aria-hidden />;

  return (
    <div className="server-controls">
      <div className="row controls">
        {running ? (
          <>
            <button className="secondary" disabled={pending} onClick={() => run("restart", restartServerAction)}>
              {busy("restart") ? spinner : <RotateCw size={16} aria-hidden />} {busy("restart") ? t.doing.restart : t.restart}
            </button>
            <button className="stop" disabled={pending} onClick={() => run("stop", stopServerAction)}>
              {busy("stop") ? spinner : <Square size={16} aria-hidden />} {busy("stop") ? t.doing.stop : t.stop}
            </button>
          </>
        ) : (
          <button
            disabled={pending || live === "unknown" || live === "suspended" || live === "awaitingPayment"}
            onClick={() => run("start", startServerAction)}
          >
            {busy("start") ? spinner : <Play size={16} aria-hidden />} {busy("start") ? t.doing.start : t.start}
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
