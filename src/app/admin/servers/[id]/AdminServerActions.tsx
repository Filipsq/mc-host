"use client";

import { useActionState, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteServerAdminAction, giftDaysAction, moveServerAdminAction, playerSlotsAction, type GiftState, type MoveState, type SlotsState } from "../../actions";
import type { Messages } from "@/i18n/messages";
import { format } from "@/i18n/messages";

export function GiftForm({ id, t }: { id: string; t: Messages["admin"]["gift"] }) {
  const [state, action, pending] = useActionState<GiftState, FormData>(giftDaysAction.bind(null, id), {});
  return (
    <form action={action} className="stack">
      <div className="row gift-row">
        <label>
          {t.days}
          <input name="days" type="number" min={1} max={365} defaultValue={7} required />
        </label>
        <button disabled={pending}>{t.submit}</button>
      </div>
      {state.error && <p className={state.error === "failed" ? "notice warn" : "error"}>{t.errors[state.error]}</p>}
      {state.days && !state.error && <p className="notice success">{format(t.done, { n: state.days, date: state.date ?? "" })}</p>}
    </form>
  );
}

export function SlotsForm({ id, slots, t }: { id: string; slots: number | null; t: Messages["admin"]["slots"] }) {
  const [state, action, pending] = useActionState<SlotsState, FormData>(playerSlotsAction.bind(null, id), {});
  return (
    <form action={action} className="stack">
      <div className="row gift-row">
        <label>
          {t.slots}
          <input name="slots" type="number" min={1} defaultValue={slots ?? ""} placeholder={t.planDefault} />
        </label>
        <button disabled={pending}>{t.submit}</button>
      </div>
      {state.error && <p className={state.error === "failed" ? "notice warn" : "error"}>{t.errors[state.error]}</p>}
      {state.saved && !state.error && <p className="notice success">{t.done}</p>}
    </form>
  );
}

export function DeleteButton({ id, name, t }: { id: string; name: string; t: Messages["admin"]["remove"] }) {
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <div className="stack">
      <div>
        <button
          className="danger"
          disabled={pending}
          onClick={() => {
            if (!confirm(format(t.confirm, { name }))) return;
            startTransition(async () => setFailed(!!(await deleteServerAdminAction(id))?.error));
          }}
        >
          <Trash2 size={16} aria-hidden /> {t.submit}
        </button>
      </div>
      {failed && <p className="error">{t.failed}</p>}
    </div>
  );
}

export function MoveForm({ id, nodes, t }: { id: string; nodes: { id: string; label: string }[]; t: Messages["admin"]["move"] }) {
  const [state, action, pending] = useActionState<MoveState, FormData>(moveServerAdminAction.bind(null, id), {});
  return (
    <form action={action} className="stack">
      <div className="row gift-row">
        <label>
          {t.to}
          <select name="node" required>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label}
              </option>
            ))}
          </select>
        </label>
        <button disabled={pending}>{pending ? t.moving : t.submit}</button>
      </div>
      {state.error && <p className={state.error === "failed" ? "notice warn" : "error"}>{t.errors[state.error]}</p>}
      {state.moved && !state.error && <p className="notice success">{format(t.done, { node: state.moved })}</p>}
    </form>
  );
}
