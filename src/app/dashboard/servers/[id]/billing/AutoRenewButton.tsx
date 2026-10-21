"use client";

import { useTransition } from "react";
import { setAutoRenewAction } from "../../actions";

/** Turns the server's automatic renewal on or off. */
export default function AutoRenewButton({ serverId, on, label }: { serverId: string; on: boolean; label: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" className="secondary" disabled={pending} onClick={() => start(() => setAutoRenewAction(serverId, on))}>
      {label}
    </button>
  );
}
