import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { getMessages } from "@/i18n/server";
import { getOwnedServer } from "@/lib/servers";
import { JAVA_VERSIONS } from "@/lib/settings";
import SettingsForm from "./SettingsForm";

export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;
  const server = await getOwnedServer(id, session.user.id);
  if (!server) notFound();
  const t = await getMessages();

  // Keep a version that's no longer offered selectable, so saving doesn't change it.
  const versions = JAVA_VERSIONS.includes(server.version) ? JAVA_VERSIONS : [server.version, ...JAVA_VERSIONS];

  return (
    <main className="wide-form stack">
      <Link className="back" href={`/dashboard/servers/${server.id}`}>← {server.name}</Link>
      <h1>{t.settings.title}</h1>
      <SettingsForm
        serverId={server.id}
        edition={server.edition}
        name={server.name}
        versions={versions}
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
