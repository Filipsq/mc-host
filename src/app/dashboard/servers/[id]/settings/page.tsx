import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getMessages } from "@/i18n/server";
import { allows, getServerAccess } from "@/lib/access";
import { LOGIN_MODS, canCrossplay, canRunNonPremium, loginLoader } from "@/lib/plugins";
import { bedrockHost } from "@/lib/servers";
import { maxPlayersFor, serverPlayerLimit, versionsFor, viewDistanceDefault, viewDistanceMax } from "@/lib/settings";
import { planById } from "@/lib/plans";
import { isModLoader } from "@/lib/modpacks";
import { kindLabel } from "@/lib/serverType";
import { format } from "@/i18n/messages";
import { isWorldDifficulty, isWorldSize } from "@/lib/terraria";
import IconForm from "./IconForm";
import SettingsForm from "./SettingsForm";
import TerrariaSettingsForm from "./TerrariaSettingsForm";

export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;
  const access = await getServerAccess(id, session.user.id);
  if (!access || !allows(access, "settings")) notFound();
  const { server } = access;
  const t = await getMessages();

  if (server.edition === "TERRARIA") {
    const tt = t.terraria;
    const world = format(tt.world, {
      size: isWorldSize(server.levelType) ? tt.sizes[server.levelType] : "",
      difficulty: isWorldDifficulty(server.difficulty) ? tt.difficulties[server.difficulty] : "",
    });
    return (
      <div className="wide-form stack">
        <h2>{t.settings.title}</h2>
        <TerrariaSettingsForm
          serverId={server.id}
          name={server.name}
          world={world}
          initial={{ motd: server.motd, password: server.serverPassword ?? "" }}
          t={t.settings}
          terraria={tt}
        />
      </div>
    );
  }

  // Keep a version that's no longer offered selectable, so saving doesn't change it.
  const offered = versionsFor(server.kind);
  const versions = offered.includes(server.version) ? offered : [server.version, ...offered];
  // Game modes and mod packs decide the version themselves.
  const versionNote =
    server.kind === "modpack"
      ? format(t.settings.versionModpack, {
          mc: server.version,
          title: server.modpackTitle ?? server.modpack ?? "",
          version: server.modpackVersion ?? "",
        })
      : server.kind === "skyblock" || server.kind === "oneblock"
        ? format(t.settings.versionGameMode, { kind: t.server.kinds[server.kind] })
        : undefined;

  return (
    <div className="wide-form stack">
      <h2>{t.settings.title}</h2>
      {server.edition === "JAVA" && allows(access, "owner") && (
        <div className="card row">
          <span className="stack-tight">
            <span>
              <strong>{t.serverType.title}</strong> <span className="muted">· {kindLabel(server, t)}</span>
            </span>
            <span className="muted small">{t.serverType.cardText}</span>
          </span>
          <Link className="button secondary" href={`/dashboard/servers/${server.id}/type`}>
            {t.serverType.change}
          </Link>
        </div>
      )}
      <SettingsForm
        serverId={server.id}
        edition={server.edition}
        name={server.name}
        versions={versions}
        versionNote={versionNote}
        versionHint={isModLoader(server.kind) ? `${t.settings.versionHint} ${t.settings.versionMods}` : undefined}
        playerLimit={serverPlayerLimit(server, planById(server.plan))}
        viewDistance={{ max: viewDistanceMax(server.plan), def: viewDistanceDefault(server.plan) }}
        nonPremium={
          server.edition === "JAVA"
            ? {
                offered: canRunNonPremium(server),
                on: !server.onlineMode,
                ...(loginLoader(server) && { versions: LOGIN_MODS[loginLoader(server)!].versions }),
              }
            : undefined
        }
        crossplay={
          server.edition === "JAVA"
            ? { offered: canCrossplay(server), on: server.crossplay, host: bedrockHost(server), port: server.port ?? 0 }
            : undefined
        }
        initial={{
          version: server.version,
          gameMode: server.gameMode,
          difficulty: server.difficulty,
          motd: server.motd,
          pvp: server.pvp,
          maxPlayers: maxPlayersFor(server, planById(server.plan)) || serverPlayerLimit(server, planById(server.plan)),
          allowFlight: server.allowFlight,
          hardcore: server.hardcore,
          commandBlocks: server.commandBlocks,
          allowNether: server.allowNether,
          forceGamemode: server.forceGamemode,
          spawnMonsters: server.spawnMonsters,
          spawnProtection: server.spawnProtection,
          viewDistance: Math.min(server.viewDistance ?? viewDistanceDefault(server.plan), viewDistanceMax(server.plan)),
          whitelist: server.whitelist,
          players: server.whitelistPlayers.join("\n"),
        }}
        t={t.settings}
      />
      {server.edition === "JAVA" && <IconForm serverId={server.id} t={t.settings} />}
    </div>
  );
}
