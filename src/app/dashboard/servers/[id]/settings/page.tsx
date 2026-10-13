import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getMessages } from "@/i18n/server";
import { getServerFor } from "@/lib/access";
import { JAVA_VERSIONS } from "@/lib/settings";
import { format } from "@/i18n/messages";
import SettingsForm from "./SettingsForm";

export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;
  const server = await getServerFor(id, session.user.id, "settings");
  if (!server) notFound();
  const t = await getMessages();

  // Keep a version that's no longer offered selectable, so saving doesn't change it.
  const versions = JAVA_VERSIONS.includes(server.version) ? JAVA_VERSIONS : [server.version, ...JAVA_VERSIONS];
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
      <SettingsForm
        serverId={server.id}
        edition={server.edition}
        name={server.name}
        versions={versions}
        versionNote={versionNote}
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
