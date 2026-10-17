"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deletePaymentAction, deleteTestPaymentsAction } from "./actions";
import type { Messages } from "@/i18n/messages";
import { format } from "@/i18n/messages";

type T = Messages["admin"]["paymentRemove"];

export function DeletePaymentButton({ id, t }: { id: string; t: T }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="danger small"
      disabled={pending}
      onClick={() => {
        if (confirm(t.confirmOne)) startTransition(() => deletePaymentAction(id));
      }}
    >
      <Trash2 size={14} aria-hidden /> {t.one}
    </button>
  );
}

export function DeleteTestPaymentsButton({ n, t }: { n: number; t: T }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="danger"
      disabled={pending}
      onClick={() => {
        if (confirm(format(t.confirmAllTest, { n }))) startTransition(() => deleteTestPaymentsAction());
      }}
    >
      <Trash2 size={16} aria-hidden /> {format(t.allTest, { n })}
    </button>
  );
}
