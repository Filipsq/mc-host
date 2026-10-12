import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { getLiveDetails, getOwnedServer, joinAddress } from "@/lib/servers";
import { diskLimitMb, formatMb, hardDiskLimitMb } from "@/lib/disk";
import { listBackups } from "@/lib/agent";
import { planById } from "@/lib/plans";
import type { Difficulty, GameMode } from "@/lib/settings";
import { ISLAND_COMMAND, LOADER_NAMES, isServerKind, modpackPage } from "@/lib/modpacks";
import { supportsPlugins } from "@/lib/plugins";
import { FolderOpen, Puzzle } from "lucide-react";
import AutoRefresh from "@/components/AutoRefresh";
import ServerControls from "./ServerControls";
import Console from "./Console";
import CopyButton from "./CopyButton";
import EditionIcon from "@/components/EditionIcon";
import Backups, { type BackupRow } from "./Backups";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ payment?: string; settings?: string }>;
};

export default async function ServerPage({ params, searchParams }: Props) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");

  const [{ id }, { payment, settings }] = await Promise.all([params, searchParams]);
  const server = await getOwnedServer(id, session.user.id);
  if (!server) notFound();

  const keep = planById(server.plan).backupsKept;
  const [all, { locale }, { live, agent }, backups] = await Promise.all([
    getMessages(),
    getPreferences(),
    getLiveDetails(server),
    // Paid servers only exist on the game host once paid for.
    keep > 0 && server.status !== "AWAITING_PAYMENT" ? listBackups(server.id).catch(() => null) : null,
  ]);
  const t = all.server;
  const b = all.billing;
  const { host, port } = joinAddress(server);
  const kind = server.edition === "JAVA" && isServerKind(server.kind) ? server.kind : "vanilla";
  const islandCommand = ISLAND_COMMAND[kind];
  const unpaid = live === "awaitingPayment" || live === "suspended";
  // What the server's files take, as the agent last measured, against what the plan gives.
  const diskUsed = agent?.diskMb;
  const diskLimit = diskLimitMb(server.plan);
  const diskVars =
    diskUsed === undefined
      ? null
      : { used: formatMb(diskUsed, locale), limit: formatMb(diskLimit, locale), hard: formatMb(hardDiskLimitMb(diskLimit), locale) };
  // Keep refreshing while starting, or while a just-made payment is being confirmed.
  const waiting = live === "starting" || live === "restarting" || (payment === "success" && unpaid);

  return (
    <main className="stack">
      <Link className="back" href="/dashboard">{t.back}</Link>
      <header className="page-head">
        <div className="page-title">
          <EditionIcon edition={server.edition} size={52} />
          <div>
            <h1>{server.name}</h1>
            <div className="meta">
              <span className="chip">{server.edition === "JAVA" ? "Java" : "Bedrock"}</span>
              <span className="chip">{all.plans[server.plan]}</span>
              <span className="chip">{server.memoryMb / 1024} GB RAM</span>
            </div>
          </div>
        </div>
        <span className={`badge ${live}`}>{t.live[live]}</span>
      </header>

      {payment === "success" && <p className="notice success">{b.success}</p>}
      {settings === "saved" && <p className="notice success">{all.settings.saved}</p>}
      {payment === "cancelled" && unpaid && <p className="notice">{b.cancelled}</p>}
      {live === "awaitingPayment" && payment !== "success" && <p className="notice">{b.awaiting}</p>}
      {live === "suspended" && <p className="notice warn">{b.suspended}</p>}
      {live === "diskFull" && diskVars && <p className="notice warn">{format(t.diskStopped, diskVars)}</p>}
      {live !== "diskFull" && diskVars && (diskUsed ?? 0) > diskLimit && <p className="notice warn">{format(t.diskOver, diskVars)}</p>}
      {live === "sleeping" && (
        <p className="notice">{server.edition === "JAVA" ? t.sleepingJava : t.sleepingBedrock}</p>
      )}

      <div className="card stack">
        <div className="address-card">
          <div>
            <p className="address-label">{t.address}</p>
            {server.edition === "JAVA" ? (
              <span className="address-value">{breakable(host)}</span>
            ) : (
              <span className="address-value">
                {breakable(host)} <span className="muted">· {t.port}</span> {port}
              </span>
            )}
          </div>
          <CopyButton text={host} label={t.copy} copiedLabel={t.copied} />
        </div>
        {server.edition === "BEDROCK" && <p className="muted small">{t.bedrockJoin}</p>}
        {islandCommand && <p className="muted small">{format(t.islandHint, { command: islandCommand })}</p>}
        {kind === "modpack" && server.modpack && (
          <p className="muted small">
            {format(t.modpackInfo, {
              title: server.modpackTitle ?? server.modpack,
              version: server.modpackVersion ?? "",
              mc: server.version,
              loader: LOADER_NAMES[server.modpackLoader ?? ""] ?? server.modpackLoader ?? "",
            })}{" "}
            {t.modpackInstall}{" "}
            <a href={modpackPage(server.modpack, server.modpackVersionId)} target="_blank" rel="noreferrer">
              {t.modpackDownload}
            </a>
          </p>
        )}
        <ServerControls id={server.id} live={live} t={t} />
      </div>

      <div className="card row">
        <span>
          <strong>{all.plans[server.plan]}</strong>{" "}
          <span className="muted">
            ·{" "}
            {server.plan === "FREE"
              ? b.freeForever
              : server.paidUntil
                ? format(server.paidUntil > new Date() ? b.paidUntil : b.expiredOn, {
                    date: new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(server.paidUntil),
                  })
                : t.live.awaitingPayment}
          </span>
        </span>
        <Link className={`button${unpaid ? "" : " secondary"}`} href={`/dashboard/servers/${server.id}/billing`}>
          {unpaid ? b.pay : b.manage}
        </Link>
      </div>

      <div className="card row">
        <span>
          <strong>{all.settings.title}</strong>{" "}
          <span className="muted">
            ·{" "}
            {[
              server.edition === "JAVA" &&
                (kind === "vanilla"
                  ? server.version === "LATEST"
                    ? all.settings.latest
                    : server.version
                  : kind === "modpack"
                    ? `${t.kinds.modpack} · ${server.version}`
                    : t.kinds[kind]),
              all.settings.modes[server.gameMode as GameMode],
              all.settings.difficulties[server.difficulty as Difficulty],
              server.whitelist && all.settings.whitelistOn,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
        <Link className="button secondary" href={`/dashboard/servers/${server.id}/settings`}>
          {all.settings.edit}
        </Link>
      </div>

      {live !== "awaitingPayment" && (
        <div className="card row">
          <span>
            <strong>{all.files.title}</strong> <span className="muted">· {all.files.cardText}</span>
            {diskVars && (
              <span className="disk-line muted small">
                {t.disk}: {format(t.diskUsage, diskVars)}
              </span>
            )}
          </span>
          <Link className="button secondary" href={`/dashboard/servers/${server.id}/files`}>
            <FolderOpen size={16} aria-hidden /> {all.files.open}
          </Link>
        </div>
      )}

      {supportsPlugins(server) && (
        <div className="card row">
          <span>
            <strong>{all.plugins.title}</strong>{" "}
            <span className="muted">
              ·{" "}
              {server.plugins.length > 0 ? format(all.plugins.cardCount, { n: server.plugins.length }) : all.plugins.cardNone}
            </span>
            {server.pluginsPending && <span className="muted"> · {all.plugins.pending}</span>}
          </span>
          <Link className="button secondary" href={`/dashboard/servers/${server.id}/plugins`}>
            <Puzzle size={16} aria-hidden /> {all.plugins.manage}
          </Link>
        </div>
      )}

      {!unpaid && <Console id={server.id} t={t} />}

      {live !== "awaitingPayment" && (
        <section className="stack">
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
        </section>
      )}
      {waiting && <AutoRefresh />}
    </main>
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

// Lets a long address wrap before a dot on narrow screens instead of mid-word.
function breakable(host: string) {
  return host.split(".").map((part, i) => (i === 0 ? part : <span key={i}><wbr />.{part}</span>));
}
