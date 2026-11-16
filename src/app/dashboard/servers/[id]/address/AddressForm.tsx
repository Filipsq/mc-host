"use client";

import { useActionState } from "react";
import { renameServerAction } from "../../actions";
import type { Messages } from "@/i18n/messages";

/** Changes only the free <name>.mchosting.pl address (the name stays as it is). */
export default function AddressForm({
  serverId,
  name,
  subdomain,
  domain,
  save,
  t,
}: {
  serverId: string;
  name: string;
  subdomain: string;
  domain: string;
  save: string;
  t: Messages["settings"]["rename"];
}) {
  const [state, action, pending] = useActionState(renameServerAction.bind(null, serverId), {});
  return (
    <form action={action} className="stack">
      <input type="hidden" name="name" value={name} />
      <label>
        {t.address}
        <span className="row">
          <input name="subdomain" defaultValue={subdomain} required minLength={3} maxLength={32} pattern="[a-zA-Z0-9-]+" />
          <span className="muted">.{domain}</span>
        </span>
        <span className="muted small">{t.addressHint}</span>
      </label>
      {state.error && <p className="error">{t.errors[state.error]}</p>}
      <button type="submit" className="secondary" disabled={pending}>
        {pending ? t.saving : save}
      </button>
    </form>
  );
}
