"use client";

import { useState, useTransition } from "react";
import { Play, Square, Trash2 } from "lucide-react";
import { deleteServerAction, startServerAction, stopServerAction } from "../actions";
import type { LiveState } from "@/lib/servers";
import type { Messages } from "@/i18n/messages";

type Props = { id: string; live: LiveState; canDelete: boolean; t: Messages["server"] };

export default function ServerControls({ id, live, canDelete, t }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const running = live === "online" || live === "starting" || live === "restarting";

  return (
    <div className="stack">
      <div className="row controls">
        {running ? (
          <button className="secondary" disabled={pending} onClick={() => startTransition(() => stopServerAction(id))}>
            <Square size={16} aria-hidden /> {t.stop}
          </button>
        ) : (
          <button
            disabled={pending || live === "unknown" || live === "suspended" || live === "awaitingPayment"}
            onClick={() =>
              startTransition(async () => {
                const result = await startServerAction(id);
                setError(result.error ? t.errors[result.error] : null);
              })
            }
          >
            <Play size={16} aria-hidden /> {t.start}
          </button>
        )}
        {canDelete && (
          <button
            className="danger"
            disabled={pending}
            onClick={() => {
              if (confirm(t.deleteConfirm)) startTransition(() => deleteServerAction(id));
            }}
          >
            <Trash2 size={16} aria-hidden /> {t.delete}
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
