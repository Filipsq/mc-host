import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { getMessages } from "@/i18n/server";
import { gameAddress, getLiveState, getOwnedServer } from "@/lib/servers";
import AutoRefresh from "@/components/AutoRefresh";
import ServerControls from "./ServerControls";
import Console from "./Console";
import CopyButton from "./CopyButton";

export default async function ServerPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { id } = await params;
  const server = await getOwnedServer(id, session.user.id);
  if (!server) notFound();

  const [all, live] = await Promise.all([getMessages(), getLiveState(server)]);
  const t = all.server;
  const { host, port } = gameAddress(server.port);
  // Java clients take host:port in one field; Bedrock asks for them separately.
  const javaAddress = port === 25565 ? host : `${host}:${port}`;
  const transitioning = live === "starting" || live === "restarting";

  return (
    <main className="stack">
      <p><Link href="/dashboard">{t.back}</Link></p>
      <header className="row">
        <h1>{server.name}</h1>
        <span className={`badge ${live}`}>{t.live[live]}</span>
      </header>
      <p className="muted">
        {server.edition === "JAVA" ? "Java" : "Bedrock"} · {all.plans[server.plan]} · {server.memoryMb / 1024} GB RAM
      </p>

      <div className="card stack">
        {server.edition === "JAVA" ? (
          <div className="row">
            <span>{t.address}: <code>{javaAddress}</code></span>
            <CopyButton text={javaAddress} label={t.copy} copiedLabel={t.copied} />
          </div>
        ) : (
          <>
            <div className="row">
              <span>{t.address}: <code>{host}</code> · {t.port}: <code>{port}</code></span>
              <CopyButton text={host} label={t.copy} copiedLabel={t.copied} />
            </div>
            <p className="muted">{t.bedrockJoin}</p>
          </>
        )}
        <ServerControls id={server.id} live={live} t={t} />
      </div>

      <Console id={server.id} t={t} />
      {transitioning && <AutoRefresh />}
    </main>
  );
}
