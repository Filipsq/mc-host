"use client";

import { useState, useTransition } from "react";
import { disableXboxAction, enableXboxAction, type XboxActionState } from "./actions";
import type { Messages } from "@/i18n/messages";

/** Turns the console sign-in on, or off (which signs the account out). */
export default function XboxButtons({ serverId, on, t }: { serverId: string; on: boolean; t: Messages["xbox"] }) {
  const [state, setState] = useState<XboxActionState>({});
  const [pending, start] = useTransition();
  const run = (fn: (id: string) => Promise<XboxActionState>) => start(async () => setState(await fn(serverId)));

  return (
    <div className="stack-tight">
      {on ? (
        <button
          type="button"
          className="secondary"
          disabled={pending}
          onClick={() => {
            if (confirm(t.offConfirm)) run(disableXboxAction);
          }}
        >
          {pending ? t.working : t.off}
        </button>
      ) : (
        <button type="button" disabled={pending} onClick={() => run(enableXboxAction)}>
          {pending ? t.starting : t.on}
        </button>
      )}
      {state.error && <p className="notice warn">{t.errors[state.error]}</p>}
    </div>
  );
}
