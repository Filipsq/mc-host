"use client";

import { useActionState } from "react";
import { sendVerifyLinkAction } from "./actions";
import type { Messages } from "@/i18n/messages";
import { format } from "@/i18n/messages";

/** On the server list while friends' invitations wait for the address to be confirmed. */
export default function VerifyBanner({ t, email, count }: { t: Messages["emailVerify"]; email: string; count: number }) {
  const [state, action, pending] = useActionState(sendVerifyLinkAction, {});
  return (
    <div className="card stack">
      <strong>{t.bannerTitle}</strong>
      <p className="muted small">{format(t.banner, { n: count, email })}</p>
      {state.sent ? (
        <p className="notice success">{format(t.sent, { email })}</p>
      ) : (
        <form action={action}>
          {state.error && <p className="error">{t.tooMany}</p>}
          <button type="submit" className="button small" disabled={pending}>
            {pending ? t.sending : t.send}
          </button>
        </form>
      )}
    </div>
  );
}
