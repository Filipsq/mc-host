import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { crossplayAddress, getLiveDetails, joinAddress } from "@/lib/servers";
import { allows, getServerAccess, type ServerNeed } from "@/lib/access";
import { db } from "@/lib/db";
import { diskLimitMb, formatMb, hardDiskLimitMb } from "@/lib/disk";
import { deletionDate } from "@/lib/billing";
import { listBackups } from "@/lib/agent";
import { planById } from "@/lib/plans";
import { canUpgrade } from "@/lib/upgrade";
import type { Difficulty, GameMode } from "@/lib/settings";
import { ISLAND_COMMAND, LOADER_NAMES, isModLoader, isServerKind, modpackPage } from "@/lib/modpacks";
import { addonType, canCrossplay, canRunNonPremium } from "@/lib/plugins";
import { kindLabel } from "@/lib/serverType";
import { ArrowUpCircle, FolderOpen, Globe, Puzzle, Users } from "lucide-react";
import { activeLevel } from "@/lib/worlds";
import { EDITION_NAMES } from "@/lib/editions";
import { isTerrariaKind, isWorldDifficulty, isWorldSize } from "@/lib/terraria";
import AutoRefresh from "@/components/AutoRefresh";
import ServerControls from "./ServerControls";
import Console from "./Console";
import Stats from "./Stats";
import CopyButton from "@/components/CopyButton";
import EditionIcon from "@/components/EditionIcon";
import Backups, { type BackupRow } from "./Backups";
import TestPaymentNotice from "@/components/TestPaymentNotice";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ payment?: string; settings?: string; type?: string }>;
};

export default async function ServerPage({ params, searchParams }: Props) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");

  const [{ id }, { payment, settings, type: typeChanged }] = await Promise.all([params, searchParams]);
  const access = await getServerAccess(id, session.user.id);
  if (!access) notFound();
  const { server } = access;
  // Friends see what the owner let them use; the rest of the panel stays hidden.
  const can = (need: ServerNeed) => allows(access, need);

  const keep = planById(server.plan).backupsKept;
  const [all, { locale }, { live, agent }, backups, friends] = await Promise.all([
    getMessages(),
    getPreferences(),
    getLiveDetails(server),
    // Paid servers only exist on the game host once paid for.
    keep > 0 && server.status !== "AWAITING_PAYMENT" && can("backups") ? listBackups(server.id).catch(() => null) : null,
    can("owner") ? db.serverMember.count({ where: { serverId: server.id } }) : 0,
  ]);
  const t = all.server;
  const b = all.billing;
  const tt = all.terraria;
  const terraria = server.edition === "TERRARIA";
  const terrariaKind = terraria && isTerrariaKind(server.kind) ? server.kind : null;
  const { host, port } = joinAddress(server);
  const bedrock = crossplayAddress(server);
  const kind = server.edition === "JAVA" && isServerKind(server.kind) ? server.kind : "vanilla";
  const islandCommand = ISLAND_COMMAND[kind];
  // Plugins on Paper, mods on a mod loader; the card reads accordingly.
  const addons = {
    plugin: all.plugins,
    mod: { ...all.plugins, ...all.mods },
    workshop: { ...all.plugins, ...all.mods, ...all.workshop },
    none: null,
  }[addonType(server) ?? "none"];
  const unpaid = live === "awaitingPayment" || live === "suspended";
  // What the server's files take, as the agent last measured, against what the plan gives.
  const diskUsed = agent?.diskMb;
  const diskLimit = diskLimitMb(server.plan);
  const diskVars =
    diskUsed === undefined
      ? null
      : { used: formatMb(diskUsed, locale), limit: formatMb(diskLimit, locale), hard: formatMb(hardDiskLimitMb(diskLimit), locale) };
  // The Settings card's one line.
  const settingsSummary = (
    terraria
      ? [
          terrariaKind && tt.kinds[terrariaKind],
          format(tt.world, {
            size: isWorldSize(server.levelType) ? tt.sizes[server.levelType] : "",
            difficulty: isWorldDifficulty(server.difficulty) ? tt.difficulties[server.difficulty] : "",
          }),
          server.serverPassword && tt.passwordOn,
        ]
      : [
          server.edition === "JAVA" &&
            (kind === "vanilla"
              ? server.version === "LATEST"
                ? all.settings.latest
                : server.version
              : kind === "modpack" || isModLoader(kind)
                ? `${t.kinds[kind]} · ${server.version === "LATEST" ? all.settings.latest : server.version}`
                : t.kinds[kind]),
          all.settings.modes[server.gameMode as GameMode],
          all.settings.difficulties[server.difficulty as Difficulty],
          server.whitelist && all.settings.whitelistOn,
          !server.onlineMode && canRunNonPremium(server) && all.settings.nonPremiumOn,
          server.crossplay && canCrossplay(server) && all.settings.crossplayOn,
        ]
  )
    .filter(Boolean)
    .join(" · ");
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
              <span className="chip">{EDITION_NAMES[server.edition]}</span>
              {terrariaKind && terrariaKind !== "vanilla" && <span className="chip">{tt.kinds[terrariaKind]}</span>}
              <span className="chip">{all.plans[server.plan]}</span>
              <span className="chip">{server.memoryMb / 1024} GB RAM</span>
            </div>
          </div>
        </div>
        <span className={`badge ${live}`}>{t.live[live]}</span>
      </header>

      {payment === "success" && <p className="notice success">{b.success}</p>}
      {payment !== "success" && <TestPaymentNotice userId={session.user.id} all={all} locale={locale} serverId={server.id} />}
      {settings === "saved" && <p className="notice success">{all.settings.saved}</p>}
      {typeChanged === "changed" && server.edition === "JAVA" && (
        <p className="notice success">{format(all.serverType.done, { type: kindLabel(server, all), world: activeLevel(server) })}</p>
      )}
      {payment === "cancelled" && unpaid && <p className="notice">{b.cancelled}</p>}
      {live === "awaitingPayment" && payment !== "success" && <p className="notice">{b.awaiting}</p>}
      {live === "suspended" && (
        <p className="notice warn">
          {format(b.suspended, {
            date: deletionDate(server).toLocaleDateString(locale, { dateStyle: "long", timeZone: "Europe/Warsaw" }),
          })}
        </p>
      )}
      {live === "diskFull" && diskVars && <p className="notice warn">{format(t.diskStopped, diskVars)}</p>}
      {live !== "diskFull" && diskVars && (diskUsed ?? 0) > diskLimit && <p className="notice warn">{format(t.diskOver, diskVars)}</p>}
      {live === "sleeping" && (
        <p className="notice">{server.edition === "JAVA" ? t.sleepingJava : t.sleepingBedrock}</p>
      )}

      <div className="card stack">
        <div className="address-card">
          <div>
            <p className="address-label">{bedrock ? t.javaAddress : t.address}</p>
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
        {terraria && (
          <p className="muted small">
            {tt.join}
            {server.serverPassword && (
              <>
                <br />
                {format(tt.joinPassword, { password: server.serverPassword })}
              </>
            )}
          </p>
        )}
        {terrariaKind === "tshock" && can("console") && <p className="muted small">{tt.tshockSetup}</p>}
        {terrariaKind === "tmodloader" && <p className="muted small">{tt.tmodJoin}</p>}
        {terraria && live === "starting" && <p className="muted small">{terrariaKind === "tmodloader" ? tt.tmodFirstStart : tt.firstStart}</p>}
        {bedrock && (
          <>
            <div className="address-card">
              <div>
                <p className="address-label">{t.crossplayAddress}</p>
                <span className="address-value">
                  {breakable(bedrock.host)} <span className="muted">· {t.port}</span> {bedrock.port}
                </span>
              </div>
              <CopyButton text={bedrock.host} label={t.copy} copiedLabel={t.copied} />
            </div>
            <p className="muted small">
              {t.crossplayJoin} {!planById(server.plan).alwaysOn && t.crossplaySleeping}
            </p>
          </>
        )}
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
            <a href={modpackPage(server.modpack, server.modpackVersionId, server.modpackSource)} target="_blank" rel="noreferrer">
              {t.modpackDownload}
            </a>
          </p>
        )}
        {isModLoader(kind) && (
          <p className="muted small">
            {format(t.modsInfo, {
              loader: LOADER_NAMES[kind],
              version: server.version === "LATEST" ? all.settings.latest : server.version,
            })}
          </p>
        )}
        <ServerControls id={server.id} live={live} canDelete={can("owner")} t={t} />
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
        {can("owner") && (
          <span className="row">
            {canUpgrade(server) && (
              <Link className="button" href={`/dashboard/servers/${server.id}/upgrade`}>
                <ArrowUpCircle size={16} aria-hidden /> {all.upgrade.open}
              </Link>
            )}
            <Link className={`button${unpaid ? "" : " secondary"}`} href={`/dashboard/servers/${server.id}/billing`}>
              {unpaid ? b.pay : b.manage}
            </Link>
          </span>
        )}
      </div>

      <div className="card row">
        <span>
          <strong>{all.settings.title}</strong>{" "}
          <span className="muted">
            ·{" "}
            {settingsSummary}
          </span>
        </span>
        {can("settings") && (
          <Link className="button secondary" href={`/dashboard/servers/${server.id}/settings`}>
            {all.settings.edit}
          </Link>
        )}
      </div>

      {live !== "awaitingPayment" && can("files") && (
        <div className="card row">
          <span>
            <strong>{all.files.title}</strong>{" "}
            <span className="muted">
              · {terraria ? all.files.cardTextTerraria : server.kind === "modpack" || isModLoader(server.kind) ? all.files.cardTextMods : all.files.cardText}
            </span>
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

      {live !== "awaitingPayment" && can("files") && !terraria && (
        <div className="card row">
          <span>
            <strong>{all.worlds.title}</strong>{" "}
            <span className="muted">
              · {format(all.worlds.cardCurrent, { name: activeLevel(server) })} · {all.worlds.cardText}
            </span>
          </span>
          <Link className="button secondary" href={`/dashboard/servers/${server.id}/worlds`}>
            <Globe size={16} aria-hidden /> {all.worlds.open}
          </Link>
        </div>
      )}

      {addons && can("plugins") && (
        <div className="card row">
          <span>
            <strong>{addons.title}</strong>{" "}
            <span className="muted">
              · {server.plugins.length > 0 ? format(addons.cardCount, { n: server.plugins.length }) : addons.cardNone}
            </span>
            {server.pluginsPending && <span className="muted"> · {addons.pending}</span>}
          </span>
          <Link className="button secondary" href={`/dashboard/servers/${server.id}/plugins`}>
            <Puzzle size={16} aria-hidden /> {addons.manage}
          </Link>
        </div>
      )}

      {can("owner") && (
        <div className="card row">
          <span>
            <strong>{all.access.title}</strong>{" "}
            <span className="muted">· {friends > 0 ? format(all.access.cardCount, { n: friends }) : all.access.cardNone}</span>
          </span>
          <Link className="button secondary" href={`/dashboard/servers/${server.id}/access`}>
            <Users size={16} aria-hidden /> {all.access.manage}
          </Link>
        </div>
      )}

      {!unpaid && (
        <Stats
          id={server.id}
          java={server.edition === "JAVA"}
          running={live === "online" || live === "starting" || live === "restarting"}
          memoryMb={server.memoryMb}
          locale={locale}
          t={t.stats}
        />
      )}

      {!unpaid && can("console") && (
        <Console
          id={server.id}
          game={terraria ? (terrariaKind === "tshock" ? "tshock" : "terraria") : server.edition === "BEDROCK" ? "bedrock" : "java"}
          t={t}
        />
      )}

      {live !== "awaitingPayment" && can("backups") && (
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
