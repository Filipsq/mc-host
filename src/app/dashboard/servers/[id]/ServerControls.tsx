"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Play, RotateCw, Square } from "lucide-react";
import { restartServerAction, startServerAction, stopServerAction } from "../actions";
import type { LiveState } from "@/lib/servers";
import type { Messages } from "@/i18n/messages";

type Props = { id: string; live: LiveState; t: Messages["server"] };

/** Start, or Restart and Stop, at the top of every page of the server's panel. */
export default function ServerControls({ id, live, t }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const running = live === "online" || live === "starting" || live === "restarting";

  function run(action: (id: string) => Promise<{ error?: keyof Messages["server"]["errors"] } | void>) {
    startTransition(async () => {
      const result = await action(id);
      setError(result?.error ? t.errors[result.error] : null);
      router.refresh();
    });
  }

  return (
    <div className="server-controls">
      <div className="row controls">
        {running ? (
          <>
            <button className="secondary" disabled={pending} onClick={() => run(restartServerAction)}>
              <RotateCw size={16} aria-hidden /> {t.restart}
            </button>
            <button className="stop" disabled={pending} onClick={() => run(stopServerAction)}>
              <Square size={16} aria-hidden /> {t.stop}
            </button>
          </>
        ) : (
          <button
            disabled={pending || live === "unknown" || live === "suspended" || live === "awaitingPayment"}
            onClick={() => run(startServerAction)}
          >
            <Play size={16} aria-hidden /> {t.start}
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
