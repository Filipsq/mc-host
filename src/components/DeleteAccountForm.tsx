"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";
import type { Messages } from "@/i18n/messages";
import { format } from "@/i18n/messages";

export type DeleteAccountState = { error?: keyof Messages["accountDelete"]["errors"]; done?: boolean };

/**
 * The confirmation for deleting a whole account, on the admin user page and on
 * the customer's /dashboard/konto: what goes with it, the account's email typed
 * again, and (for the customer) their password.
 */
export default function DeleteAccountForm({
  action,
  email,
  servers,
  paidLines,
  needsPassword,
  t,
}: {
  action: (state: DeleteAccountState, form: FormData) => Promise<DeleteAccountState>;
  email: string;
  servers: number;
  paidLines: string[];
  needsPassword: boolean;
  t: Messages["accountDelete"];
}) {
  const [state, formAction, pending] = useActionState(action, {});
  if (state.done) return <p className="notice success">{t.done}</p>;
  return (
    <form
      action={formAction}
      className="stack"
      onSubmit={(e) => {
        if (!confirm(format(t.confirm, { email }))) e.preventDefault();
      }}
    >
      <p>{format(t.servers, { n: servers })}</p>
      {paidLines.length > 0 && (
        <div className="notice warn stack">
          <span>{t.paidWarn}</span>
          <ul>
            {paidLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="muted small">{t.kept}</p>
      <input hidden readOnly type="text" name="username" autoComplete="username" value={email} />
      <label>
        {t.typeEmail}
        <input name="email" type="email" required autoComplete="off" placeholder={email} />
      </label>
      {needsPassword && (
        <label>
          {t.password}
          <input name="password" type="password" required autoComplete="current-password" />
        </label>
      )}
      {state.error && <p className="error">{t.errors[state.error]}</p>}
      <div>
        <button className="danger" type="submit" disabled={pending}>
          <Trash2 size={16} aria-hidden /> {pending ? t.wait : t.submit}
        </button>
      </div>
    </form>
  );
}
