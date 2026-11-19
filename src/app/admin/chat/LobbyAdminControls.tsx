"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, Check, Power, Trash2 } from "lucide-react";
import { format, type Messages } from "@/i18n/messages";
import { moderateLobby, type ModAction } from "@/app/dashboard/chat/actions";
import type { ReportReason } from "@/lib/lobby";

type Report = {
  id: string;
  userId: string;
  author: string;
  email: string;
  muted: string | null;
  body: string;
  server: string | null;
  time: string;
  hidden: boolean;
  reports: { reason: ReportReason; by: string; time: string }[];
};

type Props = {
  t: Messages["lobby"];
  on: boolean;
  reports: Report[];
  muted: { id: string; email: string; name: string | null; until: string | null }[];
};

const MUTE_HOURS = [1, 24, 168] as const;

/** The admin's switch for the players' chat, the reports waiting for a look, and who is muted. */
export default function LobbyAdminControls({ t, on, reports, muted }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const a = t.admin;

  function run(action: ModAction, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setError(null);
    start(async () => {
      try {
        const r = await moderateLobby(action);
        if (!r.ok) setError(t.mod.failed);
        router.refresh();
      } catch {
        setError(t.mod.failed);
      }
    });
  }

  const until = (u: string | null) => (u === "forever" ? a.forever : u ? format(a.until, { until: u }) : "");

  return (
    <div className="stack">
      <div className={`notice ${on ? "success" : "warn"} lobby-switch`}>
        <span>
          <Power size={16} aria-hidden /> {on ? a.on : a.offNow}
        </span>
        <button type="button" className={on ? "secondary small" : "small"} disabled={pending} onClick={() => run({ kind: "switch", on: !on })}>
          {on ? a.turnOff : a.turnOn}
        </button>
      </div>
      {error && <p className="error small" role="alert">{error}</p>}

      <section className="stack-tight">
        <h3>
          {a.reportsTitle} {reports.length > 0 && <span className="count-badge">{reports.length}</span>}
        </h3>
        {reports.length === 0 ? (
          <p className="muted">{a.noReports}</p>
        ) : (
          <ul className="lobby-reports">
            {reports.map((r) => (
              <li key={r.id} className="card stack-tight">
                <div className="row lobby-report-head">
                  <strong>{r.author}</strong>
                  <span className="muted small">{r.time}</span>
                  {r.hidden && <span className="chip warn">{a.hidden}</span>}
                  {r.muted && <span className="chip bad">{t.mod.mute}: {until(r.muted)}</span>}
                  <Link className="small" href={`/admin/users/${r.userId}`}>{a.account}: {r.email}</Link>
                </div>
                {r.body && <blockquote className="lobby-quote break">{r.body}</blockquote>}
                {r.server && <p className="small muted">{t.sharedServer}: {r.server}</p>}
                <ul className="small muted lobby-report-list">
                  {r.reports.map((p, i) => (
                    <li key={i}>🚩 {format(a.reportedBy, { by: p.by, reason: t.reasons[p.reason] ?? p.reason, time: p.time })}</li>
                  ))}
                </ul>
                <div className="lobby-report-actions">
                  <button type="button" className="danger small" disabled={pending} onClick={() => run({ kind: "delete", messageId: r.id })}>
                    <Trash2 size={15} aria-hidden /> {t.mod.delete}
                  </button>
                  <button type="button" className="secondary small" disabled={pending} onClick={() => run({ kind: "keep", messageId: r.id })}>
                    <Check size={15} aria-hidden /> {a.keep}
                  </button>
                  <span className="small muted"><Ban size={14} aria-hidden /> {t.mod.mute}:</span>
                  {MUTE_HOURS.map((h) => (
                    <button key={h} type="button" className="secondary small" disabled={pending} onClick={() => run({ kind: "mute", userId: r.userId, hours: h })}>
                      {t.mod.hours[String(h) as "1" | "24" | "168"]}
                    </button>
                  ))}
                  <button type="button" className="secondary small" disabled={pending} onClick={() => run({ kind: "mute", userId: r.userId, hours: null })}>
                    {t.mod.forever}
                  </button>
                  <button type="button" className="secondary small" disabled={pending} onClick={() => run({ kind: "resetName", userId: r.userId })}>
                    {t.mod.resetName}
                  </button>
                  <button type="button" className="danger small" disabled={pending} onClick={() => run({ kind: "removeAll", userId: r.userId }, t.mod.removeAllConfirm)}>
                    {t.mod.removeAll}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="stack-tight">
        <h3>{a.mutedTitle}</h3>
        {muted.length === 0 ? (
          <p className="muted">{a.noMuted}</p>
        ) : (
          <ul className="card flush lobby-muted-list">
            {muted.map((u) => (
              <li key={u.id}>
                <span className="break">
                  <strong>{u.name ?? "?"}</strong> <Link className="small" href={`/admin/users/${u.id}`}>{u.email}</Link>
                </span>
                <span className="muted small">{until(u.until)}</span>
                <button type="button" className="secondary small" disabled={pending} onClick={() => run({ kind: "unmute", userId: u.id })}>
                  {a.unmute}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
