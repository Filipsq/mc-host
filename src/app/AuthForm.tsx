"use client";

import { useActionState } from "react";
import type { FormState } from "./actions";
import type { Messages } from "@/i18n/messages";

type Props = {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  submitLabel: string;
  t: Messages["auth"];
};

export default function AuthForm({ action, submitLabel, t }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="card stack">
      <label>
        {t.email}
        <input name="email" type="email" required autoComplete="email" defaultValue={state.email} key={state.email} />
      </label>
      <label>
        {t.password}
        <input name="password" type="password" required minLength={8} autoComplete="current-password" />
      </label>
      {state.error && <p className="error">{t.errors[state.error]}</p>}
      <button type="submit" disabled={pending}>
        {pending ? t.wait : submitLabel}
      </button>
    </form>
  );
}
