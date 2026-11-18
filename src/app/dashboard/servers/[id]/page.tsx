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
import { formatPrice, planById } from "@/lib/plans";
import { ADDON_SPECS, hasOwnDomain } from "@/lib/addons";
import { canUpgrade } from "@/lib/upgrade";
import { START_OFFER_DISCOUNT, startOfferEnds } from "@/lib/startOffer";
import { RENEW_CODE_DISCOUNT, activeRenewCode } from "@/lib/renewCode";
import type { Difficulty, GameMode } from "@/lib/settings";
import { ISLAND_COMMAND, LOADER_NAMES, isModLoader, isServerKind, modpackPage } from "@/lib/modpacks";
import { canCrossplay, canRunNonPremium } from "@/lib/plugins";
import { usesClassicPanel } from "@/lib/panelView";
import { kindLabel, shownVersion } from "@/lib/serverType";
import { latestVersionNumber } from "@/lib/addonVersions";
import { ArrowUpCircle, Gift, Globe } from "lucide-react";
import { activeLevel } from "@/lib/worlds";
import { isTerrariaKind, isWorldDifficulty, isWorldSize } from "@/lib/terraria";
import { isOtherGame, isValheimPreset } from "@/lib/otherGames";
import AutoRefresh from "@/components/AutoRefresh";
import { takesBedrockPlayers } from "@/lib/xbox";
import ClassicOverview from "./ClassicOverview";
import Stats from "./Stats";
import StartSteps from "./StartSteps";
import CopyButton from "@/components/CopyButton";
import TestPaymentNotice from "@/components/TestPaymentNotice";
import UndoNotice from "./undo/UndoNotice";
import AdReward from "./AdReward";
import { db } from "@/lib/db";
import { AD_MANAGER_REWARDED_UNIT } from "@/lib/ads";
import { AD_WATCHES_PER_DAY, AD_WINDOW_MS, adBonus, adBoostLevel } from "@/lib/adReward";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ payment?: string; settings?: string; type?: string; dropped?: string; prezent?: string; undo?: string }>;
};

export default async function ServerPage({ params, searchParams }: Props) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");

  const [{ id }, { payment, settings, type: typeChanged, dropped, prezent, undo }] = await Promise.all([params, searchParams]);
  const access = await getServerAccess(id, session.user.id);
  if (!access) notFound();
  const { server } = access;
  // Friends see what the owner let them use; the rest of the panel stays hidden.
  const can = (need: ServerNeed) => allows(access, need);

  const [all, { locale, currency }, { live, agent }, latest, classic] = await Promise.all([
    getMessages(),
    getPreferences(),
    getLiveDetailsOnce(server.id, server.status),
    server.edition === "JAVA" && server.version === "LATEST" ? latestVersionNumber(server.kind) : undefined,
    usesClassicPanel(session.user.id),
  ]);
  const version = shownVersion(server.version, all.settings.latest, latest);
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
  const og = all.otherGames;
  const settingsSummary = (
    server.edition === "VALHEIM"
      ? [isValheimPreset(server.difficulty) && og.valheim.presets[server.difficulty], og.valheim.passwordOn]
      : server.edition === "HYTALE"
        ? [og.hytale.summary]
        : terraria
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
              ? version
              : kind === "modpack" || isModLoader(kind)
                ? `${t.kinds[kind]} · ${version}`
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
  // A running start offer (startOffer.ts), shown to the owner on their free servers.
  const offerEnds = server.plan === "FREE" && can("owner") ? await startOfferEnds(session.user.id) : null;
  // The renewal code sent with the reminder (renewCode.ts), until it's used or runs out.
  const renewCode = server.plan !== "FREE" && !server.autoRenew && can("owner") ? activeRenewCode(server) : null;
  // The "watch an ad" reward (adReward.ts): free servers, their owner, once Ad Manager is set up.
  const adsOn = !!AD_MANAGER_REWARDED_UNIT && server.plan === "FREE" && can("owner") && !unpaid;
  const watches = adsOn
    ? await db.adWatch.findMany({
        where: { serverId: server.id, createdAt: { gt: new Date(Date.now() - AD_WINDOW_MS) } },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      })
    : [];
  const adsLeft = Math.max(0, AD_WATCHES_PER_DAY - watches.length);

  return (
    <div className="stack">
      {payment === "success" && <p className="notice success">{b.success}</p>}
      {prezent === "ok" && server.plan !== "FREE" && <p className="notice success">{format(all.gifts.redeemed, { plan: all.plans[server.plan] })}</p>}
      {payment !== "success" && <TestPaymentNotice userId={session.user.id} all={all} locale={locale} serverId={server.id} />}
      {settings === "saved" && <p className="notice success">{all.settings.saved}</p>}
      {(settings === "saved" || typeChanged === "changed") && dropped && (
        <p className="notice warn">{format(all.plugins.droppedOnVersion, { list: dropped.slice(0, 300) })}</p>
      )}
      {typeChanged === "changed" && server.edition === "JAVA" && (
        <p className="notice success">{format(all.serverType.done, { type: kindLabel(server, all, latest), world: activeLevel(server) })}</p>
      )}
      {undo && undo in all.undoChange.results && (
        <p className={undo === "done" ? "notice success" : "notice warn"}>{all.undoChange.results[undo as keyof typeof all.undoChange.results]}</p>
      )}
      <UndoNotice server={server} all={all} locale={locale} owner={can("owner")} />
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
      {offerEnds && !server.deletionWarnedAt && (
        <div className="notice success row">
          <span className="stack-tight">
            <strong>{format(all.startOffer.title, { n: START_OFFER_DISCOUNT })}</strong>
            <span>
              {format(all.startOffer.text, {
                n: START_OFFER_DISCOUNT,
                date: offerEnds.toLocaleDateString(locale, { dateStyle: "long", timeZone: "Europe/Warsaw" }),
              })}
            </span>
          </span>
          <Link className="button" href={`/dashboard/servers/${server.id}/billing`}>
            <Gift size={16} aria-hidden /> {all.startOffer.button}
          </Link>
        </div>
      )}
      {renewCode && (
        <div className="notice success row">
          <span className="stack-tight">
            <strong>{format(b.renewCodeTitle, { n: RENEW_CODE_DISCOUNT })}</strong>
            <span>
              {format(b.renewCodeText, {
                n: RENEW_CODE_DISCOUNT,
                code: renewCode.code,
                until: renewCode.until.toLocaleDateString(locale, { dateStyle: "long", timeZone: "Europe/Warsaw" }),
              })}
            </span>
          </span>
          <Link className="button" href={`/dashboard/servers/${server.id}/billing?kod=${renewCode.code}`}>
            <Gift size={16} aria-hidden /> {b.renewCodeButton}
          </Link>
        </div>
      )}
      {live === "diskFull" && diskVars && <p className="notice warn">{format(t.diskStopped, diskVars)}</p>}
      {live !== "diskFull" && diskVars && (diskUsed ?? 0) > diskLimit && <p className="notice warn">{format(t.diskOver, diskVars)}</p>}
      {live === "sleeping" && (
        <p className="notice">{server.edition === "JAVA" ? t.sleepingJava : server.edition === "BEDROCK" ? t.sleepingBedrock : t.sleepingTerraria}</p>
      )}

      {server.edition === "JAVA" && live === "starting" && can("console") && <StartSteps id={server.id} t={t.startSteps} />}
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
          <span className="row">
            {/* "Zmień adres" outside Settings, leading with the own domain (Fiq, 2026-11-16). */}
            {server.edition === "JAVA" && can("owner") && (
              <Link className="button secondary small" href={`/dashboard/servers/${server.id}/address`}>
                {all.paidAddons.address.button}
              </Link>
            )}
            <CopyButton text={server.edition === "VALHEIM" || server.edition === "HYTALE" ? `${host}:${port}` : host} label={t.copy} copiedLabel={t.copied} />
          </span>
        </div>
        {server.edition === "JAVA" && can("owner") && !hasOwnDomain(server) && (
          <p className="small">
            <Link href={`/dashboard/servers/${server.id}/address`} className="row-inline">
              <Globe size={14} aria-hidden /> {format(all.paidAddons.address.teaser, { price: formatPrice(ADDON_SPECS.domain.price[currency], currency, locale) })}
            </Link>
          </p>
        )}
        {server.edition === "BEDROCK" && <p className="muted small">{t.bedrockJoin}</p>}
        {server.edition === "VALHEIM" && (
          <p className="muted small">
            {format(og.valheim.join, { address: `${host}:${port}` })}
            {server.serverPassword && (
              <>
                <br />
                {format(og.valheim.joinPassword, { password: server.serverPassword })}
              </>
            )}
          </p>
        )}
        {server.edition === "HYTALE" && <p className="muted small">{format(og.hytale.join, { address: `${host}:${port}` })}</p>}
        {isOtherGame(server.edition) && live === "starting" && <p className="muted small">{og[server.edition === "VALHEIM" ? "valheim" : "hytale"].firstStart}</p>}
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
        {can("owner") && takesBedrockPlayers(server) && !server.xbox && (
          <p className="muted small">
            {all.xbox.overviewHint} <Link href={`/dashboard/servers/${server.id}/xbox`}>{all.xbox.overviewLink}</Link>
          </p>
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
              version,
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

      {adsOn && (
        <AdReward
          id={server.id}
          unit={AD_MANAGER_REWARDED_UNIT}
          level={adBoostLevel(server)}
          until={adBoostLevel(server) > 0 ? server.adBoostUntil!.toISOString() : null}
          left={adsLeft}
          nextAt={adsLeft === 0 && watches[0] ? new Date(watches[0].createdAt.getTime() + AD_WINDOW_MS).toISOString() : null}
          running={live === "online" || live === "starting"}
          locale={locale}
          t={all.adReward}
        />
      )}

      {!unpaid && !classic && (
        <Stats
          id={server.id}
          java={server.edition === "JAVA"}
          running={live === "online" || live === "starting" || live === "restarting"}
          memoryMb={server.memoryMb + adBonus(server).memoryMb}
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

      {classic && <ClassicOverview server={server} live={live} can={can} locale={locale} />}

      {waiting && <AutoRefresh />}
    </div>
  );
}

// Lets a long address wrap before a dot on narrow screens instead of mid-word.
function breakable(host: string) {
  return host.split(".").map((part, i) => (i === 0 ? part : <span key={i}><wbr />.{part}</span>));
}
