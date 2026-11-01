"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Messages } from "@/i18n/messages";
import { disconnectHytaleAction, pollHytaleLoginAction, startHytaleLoginAction } from "./actions";

type Props = {
  kind: "server" | "downloader";
  status: { connected: boolean; profileName: string | null; pending: { code: string; url: string } | null };
  t: Messages["admin"]["hytale"];
};

/** One of the two sign-ins: its state, and the button and code to sign in with. */
export default function HytaleLogin({ kind, status, t }: Props) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [message, setMessage] = useState<string>();

  // While a code is shown, ask every 5 seconds whether the admin finished on Hytale's page.
  useEffect(() => {
    if (!status.pending) return;
    const timer = setInterval(async () => {
      const result = await pollHytaleLoginAction(kind);
      if (result === "pending") return;
      clearInterval(timer);
      setMessage(result === "done" ? t.done : result === "expired" ? t.expired : t.failed);
      router.refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [status.pending, kind, router, t]);

  return (
    <div className="stack">
      <p>
        {status.connected ? (
          <span className="badge online">{status.profileName ? `${t.connectedAs} ${status.profileName}` : t.connected}</span>
        ) : (
          <span className="badge stopped">{t.notConnected}</span>
        )}
      </p>
      {status.pending ? (
        <div className="notice stack-tight">
          <span>{t.step1}</span>
          <a href={status.pending.url} target="_blank" rel="noopener noreferrer" className="button">
            {t.open}
          </a>
          <span>
            {t.step2} <strong className="address-value">{status.pending.code}</strong>
          </span>
          <span className="muted small">{t.waiting}</span>
        </div>
      ) : (
        <div className="row">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              startTransition(async () => {
                setMessage(undefined);
                const res = await startHytaleLoginAction(kind);
                if (res.error) setMessage(t.failed);
                router.refresh();
              })
            }
          >
            {status.connected ? t.reconnect : t.connect}
          </button>
          {status.connected && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() =>
                startTransition(async () => {
                  await disconnectHytaleAction(kind);
                  router.refresh();
                })
              }
            >
              {t.disconnect}
            </button>
          )}
        </div>
      )}
      {message && <p className="muted small">{message}</p>}
    </div>
  );
}
