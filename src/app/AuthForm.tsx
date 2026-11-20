"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { FormState } from "./actions";
import type { Messages } from "@/i18n/messages";
import LinkedText from "@/components/legal/LinkedText";
import PasswordField from "./PasswordField";

type Props = {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  submitLabel: string;
  t: Messages["auth"];
  legal?: Messages["legal"]; // sign-up only: accept the terms
  forgot?: boolean; // log-in only: link to resetting the password
  opis?: string; // a server description from the home page's AI box, kept for after signing in
};

export default function AuthForm({ action, submitLabel, t, legal, forgot, opis }: Props) {
  const [state, formAction, pending] = useActionState(action, {});
  // Counts submits that came back with an error, so the password field shakes each time.
  const [errors, setErrors] = useState(0);
  const [seen, setSeen] = useState(state);
  if (seen !== state) {
    setSeen(state);
    if (state.error) setErrors((n) => n + 1);
  }
  return (
    <form action={formAction} className="stack auth-form">
      {opis && <input type="hidden" name="opis" value={opis} />}
      <label>
        {t.email}
        <input name="email" type="email" required autoComplete="email" defaultValue={state.email} key={state.email} />
      </label>
      <PasswordField label={t.password} t={t} isNew={!!legal} errorTick={errors} pending={pending} />
      {forgot && (
        <Link className="small forgot-link" href="/reset-hasla">
          {t.forgotPassword}
        </Link>
      )}
      {legal && (
        <>
          <label className="check">
            <input name="terms" type="checkbox" required />
            <span>
              <LinkedText text={legal.acceptTerms} href="/regulamin" label={legal.termsLink} newTab />
            </span>
          </label>
          <p className="muted small">
            <LinkedText text={legal.privacyNote} href="/polityka-prywatnosci" label={legal.privacyLink} newTab />
          </p>
        </>
      )}
      {state.error && <p className="error" role="alert">{t.errors[state.error]}</p>}
      <button type="submit" disabled={pending}>
        {pending ? t.wait : submitLabel}
      </button>
    </form>
  );
}
