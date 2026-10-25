"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { rebuildBedrockAction, type RebuildState } from "./actions";
import type { Messages } from "@/i18n/messages";
import { format } from "@/i18n/messages";

/** Rebuilds every Bedrock and crossplay server's container (see rebuildBedrockAction). */
export default function RebuildBedrock({ t }: { t: Messages["admin"]["bedrockRebuild"] }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<RebuildState>({});
  return (
    <div className="card stack">
      <h3>{t.title}</h3>
      <p className="muted small">{t.hint}</p>
      <div>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (confirm(t.confirm)) startTransition(async () => setState(await rebuildBedrockAction()));
          }}
        >
          <RefreshCw size={16} aria-hidden /> {pending ? t.working : t.button}
        </button>
      </div>
      {state.rebuilt !== undefined && (
        <p className={state.failed ? "notice warn" : "notice"}>{format(state.failed ? t.doneFailed : t.done, { n: state.rebuilt, failed: state.failed ?? 0 })}</p>
      )}
    </div>
  );
}
