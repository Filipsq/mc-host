"use client";

import { useTransition } from "react";
import { LogOut } from "lucide-react";
import type { Messages } from "@/i18n/messages";
import { leaveServerAction } from "./access/actions";

/** Lets a friend drop a server they were let into. */
export default function LeaveButton({ id, t }: { id: string; t: Messages["access"] }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="secondary small"
      disabled={pending}
      onClick={() => {
        if (confirm(t.leaveConfirm)) start(() => leaveServerAction(id));
      }}
    >
      <LogOut size={14} aria-hidden /> {t.leave}
    </button>
  );
}
