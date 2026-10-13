"use client";

import { useActionState } from "react";
import { UserPlus } from "lucide-react";
import { format, type Messages } from "@/i18n/messages";
import type { ServerPerm } from "@/lib/access";
import { inviteFriendAction } from "./actions";
import PermChecks from "./PermChecks";

type Props = { id: string; perms: readonly ServerPerm[]; full: boolean; t: Messages["access"] };

/** Lets someone in by email, with the permissions ticked here. */
export default function InviteForm({ id, perms, full, t }: Props) {
  const [state, action, pending] = useActionState(inviteFriendAction.bind(null, id), {});
  return (
    <form action={action} className="card stack" key={state.sent}>
      <h2>{t.inviteTitle}</h2>
      <label>
        {t.email}
        <input name="email" type="email" required autoComplete="off" placeholder={t.emailPlaceholder} defaultValue={state.email} />
        <span className="muted small">{t.emailHint}</span>
      </label>
      <PermChecks perms={perms} checked={["console"]} t={t} />
      {state.sent && <p className="notice success" role="status">{format(t.sent, { email: state.sent })}</p>}
      {state.error && <p className="error" role="alert">{t.errors[state.error]}</p>}
      {full && <p className="muted small">{t.errors.tooMany}</p>}
      <div>
        <button type="submit" disabled={pending || full}>
          <UserPlus size={16} aria-hidden /> {pending ? t.inviting : t.invite}
        </button>
      </div>
    </form>
  );
}
