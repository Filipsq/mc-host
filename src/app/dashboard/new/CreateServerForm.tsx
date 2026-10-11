"use client";

import { useActionState } from "react";
import { createServerAction } from "../servers/actions";
import type { Messages } from "@/i18n/messages";

export default function CreateServerForm({ t, planInfo }: { t: Messages["server"]; planInfo: string }) {
  const [state, action, pending] = useActionState(createServerAction, {});
  return (
    <form action={action} className="card stack">
      <label>
        {t.name}
        <input name="name" required minLength={3} maxLength={32} placeholder={t.namePlaceholder} defaultValue={state.name} key={state.name} />
      </label>
      <fieldset className="stack">
        <legend>{t.edition}</legend>
        <label className="choice">
          <input type="radio" name="edition" value="JAVA" defaultChecked />
          <span>
            <strong>Java</strong> <span className="muted">{t.javaHint}</span>
          </span>
        </label>
        <label className="choice">
          <input type="radio" name="edition" value="BEDROCK" />
          <span>
            <strong>Bedrock</strong> <span className="muted">{t.bedrockHint}</span>
          </span>
        </label>
      </fieldset>
      <p className="muted">{planInfo}</p>
      {state.error && <p className="error">{t.errors[state.error]}</p>}
      <button type="submit" disabled={pending}>
        {pending ? t.creating : t.create}
      </button>
    </form>
  );
}
