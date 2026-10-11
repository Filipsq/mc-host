"use client";

import { useActionState } from "react";
import type { FormState } from "./actions";

type Props = {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  submitLabel: string;
};

export default function AuthForm({ action, submitLabel }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="card stack">
      <label>
        Email
        <input name="email" type="email" required autoComplete="email" defaultValue={state.email} key={state.email} />
      </label>
      <label>
        Password
        <input name="password" type="password" required minLength={8} autoComplete="current-password" />
      </label>
      {state.error && <p className="error">{state.error}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "Please wait..." : submitLabel}
      </button>
    </form>
  );
}
