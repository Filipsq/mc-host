"use client";

import { useTransition } from "react";
import { Play, Square, Trash2 } from "lucide-react";
import { deleteServerAction, startServerAction, stopServerAction } from "../actions";
import type { LiveState } from "@/lib/servers";
import type { Messages } from "@/i18n/messages";

type Props = { id: string; live: LiveState; t: Messages["server"] };

export default function ServerControls({ id, live, t }: Props) {
  const [pending, startTransition] = useTransition();
  const running = live === "online" || live === "starting" || live === "restarting";

  return (
    <div className="row controls">
      {running ? (
        <button className="secondary" disabled={pending} onClick={() => startTransition(() => stopServerAction(id))}>
          <Square size={16} aria-hidden /> {t.stop}
        </button>
      ) : (
        <button
          disabled={pending || live === "unknown" || live === "suspended" || live === "awaitingPayment"}
          onClick={() => startTransition(() => startServerAction(id))}>
          <Play size={16} aria-hidden /> {t.start}
        </button>
      )}
      <button
        className="danger"
        disabled={pending}
        onClick={() => {
          if (confirm(t.deleteConfirm)) startTransition(() => deleteServerAction(id));
        }}
      >
        <Trash2 size={16} aria-hidden /> {t.delete}
      </button>
    </div>
  );
}
