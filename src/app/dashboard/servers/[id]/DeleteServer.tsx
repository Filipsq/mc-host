"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteServerAction } from "../actions";
import type { Messages } from "@/i18n/messages";

export default function DeleteServer({ id, t }: { id: string; t: Messages["server"] }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      className="danger"
      disabled={pending}
      onClick={() => {
        if (confirm(t.deleteConfirm)) startTransition(() => deleteServerAction(id));
      }}
    >
      <Trash2 size={16} aria-hidden /> {t.delete}
    </button>
  );
}
