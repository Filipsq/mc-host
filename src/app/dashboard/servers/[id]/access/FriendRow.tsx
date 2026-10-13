"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { format, type Messages } from "@/i18n/messages";
import type { ServerPerm } from "@/lib/access";
import { removeFriendAction, updateFriendAction } from "./actions";
import PermChecks from "./PermChecks";

type Friend = { id: string; email: string; joined: boolean; perms: ServerPerm[] };
type Props = { id: string; friend: Friend; perms: readonly ServerPerm[]; t: Messages["access"] };

/** One friend: what they may do, and a way to take their access away. */
export default function FriendRow({ id, friend, perms, t }: Props) {
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  return (
    <li className="card stack friend">
      <span className="friend-email">
        <strong>{friend.email}</strong> <span className="chip">{friend.joined ? t.joined : t.waiting}</span>
      </span>
      <form
        className="stack"
        onChange={() => setSaved(false)}
        action={(form) =>
          start(async () => {
            await updateFriendAction(id, friend.id, form);
            setSaved(true);
          })
        }
      >
        <PermChecks perms={perms} checked={friend.perms} compact t={t} />
        <div className="row friend-save">
          <button type="submit" className="secondary small" disabled={pending}>
            {t.save}
          </button>
          {saved && <span className="muted small" role="status">{t.saved}</span>}
          <button
            type="button"
            className="danger small friend-remove"
            disabled={pending}
            onClick={() => {
              if (confirm(format(t.removeConfirm, { email: friend.email }))) start(() => removeFriendAction(id, friend.id));
            }}
          >
            <Trash2 size={14} aria-hidden /> {t.remove}
          </button>
        </div>
      </form>
    </li>
  );
}
