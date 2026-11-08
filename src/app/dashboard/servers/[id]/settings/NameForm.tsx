"use client";

import { useActionState } from "react";
import { renameServerAction } from "../../actions";
import type { Messages } from "@/i18n/messages";

/** The server's name in the panel and, on Java, the address players type. */
export default function NameForm({
  serverId,
  name,
  subdomain,
  domain,
  t,
}: {
  serverId: string;
  name: string;
  subdomain: string | null; // null: not a Java server, no address to change
  domain: string;
  t: Messages["settings"]["rename"];
}) {
  const [state, action, pending] = useActionState(renameServerAction.bind(null, serverId), {});
  return (
    <form action={action} className="card stack">
      <h2 className="card-title">{t.title}</h2>
      <label>
        {t.name}
        <input name="name" defaultValue={name} required minLength={3} maxLength={32} />
      </label>
      {subdomain !== null && (
        <label>
          {t.address}
          <span className="row">
            <input name="subdomain" defaultValue={subdomain} required minLength={3} maxLength={32} pattern="[a-zA-Z0-9-]+" />
            <span className="muted">.{domain}</span>
          </span>
          <span className="muted small">{t.addressHint}</span>
        </label>
      )}
      {state.error && <p className="error">{t.errors[state.error]}</p>}
      <button type="submit" disabled={pending}>
        {pending ? t.saving : t.save}
      </button>
    </form>
  );
}
