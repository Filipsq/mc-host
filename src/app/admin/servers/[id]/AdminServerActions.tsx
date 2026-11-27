"use client";

import { useActionState, useState, useTransition } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import { adminChangePlanAction, createDeployKeyAction, deleteServerAdminAction, removeDeployKeyAction, giftDaysAction, moveServerAdminAction, playerSlotsAction, type DeployKeyState, type GiftState, type MoveState, type PlanChangeState, type SlotsState } from "../../actions";
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

export function PlanChangeForm({
  id,
  name,
  current,
  plans,
  t,
}: {
  id: string;
  name: string;
  current: string;
  plans: { id: string; label: string }[];
  t: Messages["admin"]["planChange"];
}) {
  const [state, action, pending] = useActionState<PlanChangeState, FormData>(adminChangePlanAction.bind(null, id), {});
  const label = (plan: string) => plans.find((p) => p.id === plan)?.label ?? plan;
  return (
    <form
      action={action}
      className="stack"
      onSubmit={(e) => {
        const data = new FormData(e.currentTarget);
        const msg = format(t.confirm, { name, plan: label(String(data.get("plan"))), days: String(data.get("days")) });
        if (!confirm(msg)) e.preventDefault();
      }}
    >
      <div className="row gift-row">
        <label>
          {t.plan}
          <select name="plan" defaultValue={plans.some((p) => p.id === current) ? current : plans[0]?.id} required>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.days}
          <input name="days" type="number" min={0} max={365} defaultValue={30} required />
        </label>
        <button disabled={pending}>{t.submit}</button>
      </div>
      {state.error && <p className={state.error === "failed" ? "notice warn" : "error"}>{t.errors[state.error]}</p>}
      {state.plan && !state.error && <p className="notice success">{format(t.done, { plan: label(state.plan), date: state.date ?? "" })}</p>}
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

/** Deploy key (src/lib/deployKey.ts): make one, shown once to copy into a script, or take it away. */
export function DeployKeyForm({ id, hasKey, t }: { id: string; hasKey: boolean; t: Messages["admin"]["deployKey"] }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<DeployKeyState>({});
  const has = state.key ? true : state.removed ? false : hasKey;
  const run = (action: (id: string) => Promise<DeployKeyState>) =>
    startTransition(async () => setState(await action(id).catch(() => ({ error: "failed" as const }))));
  return (
    <div className="stack">
      <p className="small">{has ? t.active : t.none}</p>
      <div className="row">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (has && !confirm(t.confirmNew)) return;
            run(createDeployKeyAction);
          }}
        >
          <KeyRound size={16} aria-hidden /> {has ? t.renew : t.create}
        </button>
        {has && (
          <button
            type="button"
            className="secondary"
            disabled={pending}
            onClick={() => {
              if (confirm(t.confirmRemove)) run(removeDeployKeyAction);
            }}
          >
            {t.remove}
          </button>
        )}
      </div>
      {state.key && (
        <div className="stack tight">
          <p className="notice success">{t.showOnce}</p>
          <input className="mono" readOnly value={state.key} onFocus={(e) => e.currentTarget.select()} aria-label={t.create} />
        </div>
      )}
      {state.error && <p className="notice warn">{t.failed}</p>}
    </div>
  );
}
