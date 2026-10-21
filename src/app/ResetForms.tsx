"use client";

import Link from "next/link";
import { useActionState } from "react";
import { changePasswordAction, requestPasswordReset, setNewPassword } from "./actions";
import type { Messages } from "@/i18n/messages";
import { format } from "@/i18n/messages";

/** Asks for the account's email and sends it a reset link. */
export function ResetRequestForm({ t, minutes }: { t: Messages["auth"]; minutes: number }) {
  const [state, formAction, pending] = useActionState(requestPasswordReset, {});
  if (state.sent) {
    return <p className="notice success">{format(t.resetSent, { email: state.email ?? "", minutes })}</p>;
  }
  return (
    <form action={formAction} className="card stack">
      <label>
        {t.email}
        <input name="email" type="email" required autoComplete="email" defaultValue={state.email} key={state.email} />
      </label>
      {state.error && <p className="error">{t.errors[state.error]}</p>}
      <button type="submit" disabled={pending}>
        {pending ? t.wait : t.resetSubmit}
      </button>
    </form>
  );
}

/** Sets a new password with the token from the emailed link. */
export function NewPasswordForm({ t, token, email }: { t: Messages["auth"]; token: string; email: string }) {
  const [state, formAction, pending] = useActionState(setNewPassword, {});
  return (
    <form action={formAction} className="card stack">
      <input type="hidden" name="token" value={token} />
      {/* Lets password managers save the new password under the right account. */}
      <input hidden readOnly type="text" name="username" autoComplete="username" value={email} />
      <label>
        {t.newPassword}
        <input name="password" type="password" required minLength={8} autoComplete="new-password" />
      </label>
      <label>
        {t.confirmPassword}
        <input name="confirm" type="password" required minLength={8} autoComplete="new-password" />
      </label>
      {state.error && (
        <p className="error">
          {t.errors[state.error]}
          {state.error === "linkInvalid" && (
            <>
              {" "}
              <Link href="/reset-hasla">{t.requestNewLink}</Link>
            </>
          )}
        </p>
      )}
      <button type="submit" disabled={pending}>
        {pending ? t.wait : t.newPasswordSubmit}
      </button>
    </form>
  );
}

/** Changes the password of the signed-in account; asks for the current one first, if it has one. */
export function ChangePasswordForm({ t, email, hasPassword }: { t: Messages["auth"]; email: string; hasPassword: boolean }) {
  const [state, formAction, pending] = useActionState(changePasswordAction, {});
  return (
    <form action={formAction} className="card stack">
      <input hidden readOnly type="text" name="username" autoComplete="username" value={email} />
      {hasPassword && (
        <label>
          {t.currentPassword}
          <input name="current" type="password" required autoComplete="current-password" />
        </label>
      )}
      <label>
        {t.newPassword}
        <input name="password" type="password" required minLength={8} autoComplete="new-password" />
      </label>
      <label>
        {t.confirmPassword}
        <input name="confirm" type="password" required minLength={8} autoComplete="new-password" />
      </label>
      {state.error && <p className="error">{t.errors[state.error]}</p>}
      <button type="submit" disabled={pending}>
        {pending ? t.wait : hasPassword ? t.changeSubmit : t.setSubmit}
      </button>
    </form>
  );
}
