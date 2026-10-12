"use client";

import { useState, useTransition } from "react";
import { Archive, Download, RotateCcw } from "lucide-react";
import { createBackupAction, restoreBackupAction } from "../actions";
import type { Messages } from "@/i18n/messages";

// Texts that name the backup come ready-made, so the dictionaries stay on the server.
export type BackupRow = { name: string; date: string; size: string; confirm: string; restored: string };

type Props = {
  id: string;
  rows: BackupRow[];
  canChange: boolean; // false while suspended: downloads only
  t: Messages["server"];
};

export default function Backups({ id, rows, canChange, t }: Props) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"backingUp" | "restoring" | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  function run(kind: "backingUp" | "restoring", action: () => Promise<{ error?: keyof Messages["server"]["errors"] }>, done?: string) {
    setMessage(null);
    setBusy(kind);
    startTransition(async () => {
      const result = await action();
      setBusy(null);
      if (result.error) setMessage({ text: t.errors[result.error], error: true });
      else if (done) setMessage({ text: done, error: false });
    });
  }

  return (
    <div className="stack">
      {canChange && (
        <div className="row">
          <button className="secondary" disabled={pending} onClick={() => run("backingUp", () => createBackupAction(id))}>
            <Archive size={16} aria-hidden /> {t.backups.backUpNow}
          </button>
          {busy && <span className="muted small">{t.backups[busy]}</span>}
        </div>
      )}
      {message && <p className={message.error ? "error" : "notice success"}>{message.text}</p>}
      {rows.length === 0 ? (
        <p className="muted">{t.backups.empty}</p>
      ) : (
        <ul className="backup-list">
          {rows.map((b) => (
            <li key={b.name}>
              <span>
                <strong>{b.date}</strong> <span className="muted small">· {b.size}</span>
              </span>
              <span className="backup-actions">
                <a className="button secondary small" href={`/api/servers/${id}/backups/${b.name}`} download>
                  <Download size={15} aria-hidden /> {t.backups.download}
                </a>
                {canChange && (
                  <button
                    className="secondary small"
                    disabled={pending}
                    onClick={() => {
                      if (!confirm(b.confirm)) return;
                      run("restoring", () => restoreBackupAction(id, b.name), b.restored);
                    }}
                  >
                    <RotateCcw size={15} aria-hidden /> {t.backups.restore}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
