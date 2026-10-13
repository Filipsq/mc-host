"use client";

import Link from "next/link";
import { useActionState } from "react";
import type { FormState } from "./actions";
import type { Messages } from "@/i18n/messages";
import LinkedText from "@/components/legal/LinkedText";

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
  return (
    <form action={formAction} className="card stack">
      {opis && <input type="hidden" name="opis" value={opis} />}
      <label>
        {t.email}
        <input name="email" type="email" required autoComplete="email" defaultValue={state.email} key={state.email} />
      </label>
      <label>
        {t.password}
        <input name="password" type="password" required minLength={8} autoComplete="current-password" />
      </label>
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
      {state.error && <p className="error">{t.errors[state.error]}</p>}
      <button type="submit" disabled={pending}>
        {pending ? t.wait : submitLabel}
      </button>
    </form>
  );
}
