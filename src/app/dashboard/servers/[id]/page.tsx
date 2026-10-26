import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { crossplayAddress, getLiveDetailsOnce, joinAddress } from "@/lib/servers";
import { allows, getServerAccess, type ServerNeed } from "@/lib/access";
import { diskLimitMb, formatMb, hardDiskLimitMb } from "@/lib/disk";
import { deletionDate, idleDeletionDate } from "@/lib/billing";
import { starterWeekPrice } from "@/lib/planMail";
import { planById } from "@/lib/plans";
import { canUpgrade } from "@/lib/upgrade";
import type { Difficulty, GameMode } from "@/lib/settings";
import { ISLAND_COMMAND, LOADER_NAMES, isModLoader, isServerKind, modpackPage } from "@/lib/modpacks";
import { canCrossplay, canRunNonPremium } from "@/lib/plugins";
import { kindLabel } from "@/lib/serverType";
import { ArrowUpCircle } from "lucide-react";
import { activeLevel } from "@/lib/worlds";
import { isTerrariaKind, isWorldDifficulty, isWorldSize } from "@/lib/terraria";
import AutoRefresh from "@/components/AutoRefresh";
import DeleteServer from "./DeleteServer";
import Stats from "./Stats";
import CopyButton from "@/components/CopyButton";
import TestPaymentNotice from "@/components/TestPaymentNotice";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ payment?: string; settings?: string; type?: string; dropped?: string; prezent?: string }>;
};

export default async function ServerPage({ params, searchParams }: Props) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");

  const [{ id }, { payment, settings, type: typeChanged, dropped, prezent }] = await Promise.all([params, searchParams]);
  const access = await getServerAccess(id, session.user.id);
  if (!access) notFound();
  const { server } = access;
  // Friends see what the owner let them use; the rest of the panel stays hidden.
  const can = (need: ServerNeed) => allows(access, need);

  const [all, { locale, currency }, { live, agent }] = await Promise.all([
    getMessages(),
    getPreferences(),
    getLiveDetailsOnce(server.id, server.status),
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
  const unpaid = live === "awaitingPayment" || live === "suspended";
  // What the server's files take, as the agent last measured, against what the plan gives.
  const diskUsed = agent?.diskMb;
  const diskLimit = diskLimitMb(server);
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
  // (While starting, the panel's frame keeps refreshing.)
  const waiting = payment === "success" && unpaid;

  return (
    <div className="stack">
      {payment === "success" && <p className="notice success">{b.success}</p>}
      {prezent === "ok" && server.plan !== "FREE" && <p className="notice success">{format(all.gifts.redeemed, { plan: all.plans[server.plan] })}</p>}
      {payment !== "success" && <TestPaymentNotice userId={session.user.id} all={all} locale={locale} serverId={server.id} />}
      {settings === "saved" && <p className="notice success">{all.settings.saved}</p>}
      {settings === "saved" && dropped && <p className="notice warn">{format(all.mods.droppedOnVersion, { list: dropped.slice(0, 300) })}</p>}
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
      {server.plan === "FREE" && server.deletionWarnedAt && can("owner") && (
        <div className="notice warn row">
          <span>
            {format(b.idleDelete, {
              date: idleDeletionDate(server).toLocaleDateString(locale, { dateStyle: "long", timeZone: "Europe/Warsaw" }),
              starter: starterWeekPrice(currency, locale),
            })}
          </span>
          <Link className="button" href={`/dashboard/servers/${server.id}/billing`}>
            <ArrowUpCircle size={16} aria-hidden /> {b.keepServer}
          </Link>
        </div>
      )}
      {live === "diskFull" && diskVars && <p className="notice warn">{format(t.diskStopped, diskVars)}</p>}
      {live !== "diskFull" && diskVars && (diskUsed ?? 0) > diskLimit && <p className="notice warn">{format(t.diskOver, diskVars)}</p>}
      {live === "sleeping" && (
        <p className="notice">{server.edition === "JAVA" ? t.sleepingJava : server.edition === "BEDROCK" ? t.sleepingBedrock : t.sleepingTerraria}</p>
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

      <div className="card stack">
        <div className="row">
          <span>
            <strong>{all.settings.title}</strong> <span className="muted">· {settingsSummary}</span>
            {diskVars && (
              <span className="disk-line muted small">
                {t.disk}: {format(t.diskUsage, diskVars)}
              </span>
            )}
          </span>
          {can("settings") && (
            <Link className="button secondary" href={`/dashboard/servers/${server.id}/settings`}>
              {all.settings.edit}
            </Link>
          )}
        </div>
      </div>

      {can("owner") && (
        <section className="card danger-zone row">
          <span>
            <strong>{all.panel.danger}</strong>
            <span className="disk-line muted small">{all.panel.dangerText}</span>
          </span>
          <DeleteServer id={server.id} t={t} />
        </section>
      )}
      {waiting && <AutoRefresh />}
    </div>
  );
}

// Lets a long address wrap before a dot on narrow screens instead of mid-word.
function breakable(host: string) {
  return host.split(".").map((part, i) => (i === 0 ? part : <span key={i}><wbr />.{part}</span>));
}
