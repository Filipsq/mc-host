"use client";

import { useActionState } from "react";
import { saveAnnouncementAction, type AnnouncementState } from "../actions";
import type { Messages } from "@/i18n/messages";
import { format } from "@/i18n/messages";

type Props = { text: string; max: number; t: Messages["admin"]["announcement"] };

export default function AnnouncementForm({ text, max, t }: Props) {
  const [state, action, pending] = useActionState<AnnouncementState, FormData>(saveAnnouncementAction, {});
  return (
    <form action={action} className="stack">
      <label>
        {t.label}
        <textarea name="text" rows={3} maxLength={max} defaultValue={text} placeholder={t.placeholder} />
      </label>
      <label className="check">
        <input type="checkbox" name="inGame" />
        <span>{t.inGame}</span>
      </label>
      <p className="muted small">{t.hint}</p>
      <div className="row">
        <button disabled={pending}>{t.submit}</button>
      </div>
      {state.error && <p className="error">{format(t.tooLong, { n: max })}</p>}
      {state.cleared && <p className="notice success">{t.cleared}</p>}
      {state.saved && (
        <p className="notice success">
          {t.saved}
          {state.sent !== undefined && ` ${format(t.sent, { n: state.sent })}`}
        </p>
      )}
    </form>
  );
}
