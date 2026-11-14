"use client";

import { useActionState, useEffect, useRef } from "react";
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
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // "Zmień nazwę" on Przegląd links to settings#nazwa. Next.js tries to scroll to the
  // hash before this page has streamed in, so the first click landed at the top.
  // Scroll and focus here, once the form is really on screen.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const jump = () => {
      clearTimeout(timer);
      // Let Next finish updating the URL and its own scroll first, then go to the form.
      timer = setTimeout(() => {
        if (window.location.hash !== "#nazwa") return;
        formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        nameRef.current?.focus({ preventScroll: true });
      }, 50);
    };
    jump();
    window.addEventListener("hashchange", jump);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("hashchange", jump);
    };
  }, []);
  return (
    <form id="nazwa" ref={formRef} action={action} className="card stack">
      <h2 className="card-title">{t.title}</h2>
      <label>
        {t.name}
        <input ref={nameRef} name="name" defaultValue={name} required minLength={3} maxLength={32} />
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
