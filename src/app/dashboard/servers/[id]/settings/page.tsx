import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getMessages } from "@/i18n/server";
import { allows, getServerAccess } from "@/lib/access";
import { canCrossplay, canRunNonPremium } from "@/lib/plugins";
import { joinAddress } from "@/lib/servers";
import { versionsFor } from "@/lib/settings";
import { isModLoader } from "@/lib/modpacks";
import { kindLabel } from "@/lib/serverType";
import { format } from "@/i18n/messages";
import SettingsForm from "./SettingsForm";

export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;
  const access = await getServerAccess(id, session.user.id);
  if (!access || !allows(access, "settings")) notFound();
  const { server } = access;
  const t = await getMessages();

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
    <main className="wide-form stack">
      <Link className="back" href={`/dashboard/servers/${server.id}`}>← {server.name}</Link>
      <h1>{t.settings.title}</h1>
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
        nonPremium={server.edition === "JAVA" ? { offered: canRunNonPremium(server), on: !server.onlineMode } : undefined}
        crossplay={
          server.edition === "JAVA"
            ? { offered: canCrossplay(server), on: server.crossplay, host: joinAddress(server).host, port: server.port ?? 0 }
            : undefined
        }
        initial={{
          version: server.version,
          gameMode: server.gameMode,
          difficulty: server.difficulty,
          motd: server.motd,
          pvp: server.pvp,
          whitelist: server.whitelist,
          players: server.whitelistPlayers.join("\n"),
        }}
        t={t.settings}
      />
    </main>
  );
}
