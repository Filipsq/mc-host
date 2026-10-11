import Link from "next/link";
import { Plus } from "lucide-react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getMessages } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { getLiveState, joinAddress } from "@/lib/servers";
import EditionIcon from "@/components/EditionIcon";
import { logOut } from "../actions";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [all, servers] = await Promise.all([
    getMessages(),
    db.server.findMany({
      where: { ownerId: session.user.id },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const states = await Promise.all(servers.map((s) => getLiveState(s)));
  const t = all.dashboard;

  return (
    <main className="stack">
      <header className="page-head">
        <div>
          <h1>{t.title}</h1>
          <p className="muted">{format(t.signedInAs, { email: session.user.email ?? "" })}</p>
        </div>
        <div className="row">
          <Link className="button" href="/dashboard/new"><Plus size={18} aria-hidden /> {t.createServer}</Link>
          <form action={logOut}>
            <button type="submit" className="secondary">{t.logOut}</button>
          </form>
        </div>
      </header>
      {servers.length === 0 ? (
        <div className="card stack empty">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/art/island.svg" alt="" width={220} height={204} />
          <h2>{t.empty}</h2>
          <p className="muted">{t.emptyHint}</p>
          <Link className="button" href="/dashboard/new"><Plus size={18} aria-hidden /> {t.createServer}</Link>
        </div>
      ) : (
        <ul className="server-list">
          {servers.map((s, i) => (
            <li key={s.id}>
              <Link href={`/dashboard/servers/${s.id}`} className="server-link">
                <EditionIcon edition={s.edition} size={40} />
                <span className="server-main">
                  <strong>{s.name}</strong>
                  <span className="mono">{addressLabel(s)}</span>
                </span>
                <span className="server-side">
                  <span className="chip">{all.plans[s.plan]} · {s.memoryMb / 1024} GB</span>
                  <span className={`badge ${states[i]}`}>{all.server.live[states[i]]}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function addressLabel(server: Parameters<typeof joinAddress>[0]) {
  const { host, port } = joinAddress(server);
  return server.edition === "JAVA" ? host : `${host}:${port}`;
}
