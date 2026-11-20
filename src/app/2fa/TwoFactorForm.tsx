"use client";

import { useActionState } from "react";
import { verifyTwoFactor } from "./actions";
import type { Messages } from "@/i18n/messages";

export default function TwoFactorForm({ t, setup }: { t: Messages["twoFactor"]; setup: boolean }) {
  const [state, formAction, pending] = useActionState(verifyTwoFactor, {});
  return (
    <form action={formAction} className="card stack">
      <label>
        {t.codeLabel}
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          required
          autoFocus
        />
      </label>
      {state.error && <p className="error">{t.errors[state.error]}</p>}
      <button type="submit" disabled={pending}>
        {pending ? t.wait : setup ? t.confirm : t.verify}
      </button>
    </form>
  );
}
