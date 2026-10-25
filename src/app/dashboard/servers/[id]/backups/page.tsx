import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { getServerFor } from "@/lib/access";
import { getLiveDetailsOnce } from "@/lib/servers";
import { listBackups } from "@/lib/agent";
import { backupsFor } from "@/lib/addons";
import Backups, { type BackupRow } from "../Backups";

export default async function BackupsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;
  const server = await getServerFor(id, session.user.id, "backups");
  if (!server) notFound();
  if (server.status === "AWAITING_PAYMENT") redirect(`/dashboard/servers/${id}`);

  const keep = backupsFor(server);
  const [all, { locale }, { live }, backups] = await Promise.all([
    getMessages(),
    getPreferences(),
    getLiveDetailsOnce(server.id, server.status),
    keep > 0 ? listBackups(server.id).catch(() => null) : null,
  ]);
  const t = all.server;
  return (
    <div className="stack">
      <h2>{t.backups.title}</h2>
      <div className="card stack">
        {keep === 0 ? (
          <div className="row">
            <span className="muted">{t.backups.freeNote}</span>
            <Link className="button secondary small" href={`/dashboard/servers/${server.id}/billing`}>
              {t.backups.upgrade}
            </Link>
          </div>
        ) : !backups ? (
          <p className="muted">{t.backups.unavailable}</p>
        ) : (
          <>
            <p className="muted">
              {format(t.backups.intro, { n: keep })}
              {live === "suspended" && ` ${t.backups.suspendedNote}`}
            </p>
            <Backups
              id={server.id}
              rows={backupRows(backups.backups, locale, t.backups)}
              canChange={live !== "suspended" && live !== "unknown"}
              t={t}
            />
          </>
        )}
      </div>
    </div>
  );
}

function backupRows(
  backups: { name: string; size: number; createdAt: string }[],
  locale: string,
  t: { restoreConfirm: string; restored: string },
): BackupRow[] {
  // Times are shown in Polish time: that's where the servers and players are.
  const dates = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Warsaw" });
  const mb = new Intl.NumberFormat(locale, { style: "unit", unit: "megabyte", maximumFractionDigits: 1 });
  const gb = new Intl.NumberFormat(locale, { style: "unit", unit: "gigabyte", maximumFractionDigits: 1 });
  return backups.map((b) => {
    const date = dates.format(new Date(b.createdAt));
    const size = b.size >= 1024 ** 3 ? gb.format(b.size / 1024 ** 3) : mb.format(b.size / 1024 ** 2);
    return { name: b.name, date, size, confirm: format(t.restoreConfirm, { date }), restored: format(t.restored, { date }) };
  });
}

