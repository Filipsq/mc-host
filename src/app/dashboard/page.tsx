import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getMessages } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { getLiveState } from "@/lib/servers";
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
    <main>
      <header className="row">
        <h1>{t.title}</h1>
        <div className="row">
          <Link className="button" href="/dashboard/new">{t.createServer}</Link>
          <form action={logOut}>
            <button type="submit" className="secondary">{t.logOut}</button>
          </form>
        </div>
      </header>
      <p className="muted">{format(t.signedInAs, { email: session.user.email ?? "" })}</p>
      {servers.length === 0 ? (
        <div className="card">
          <p>{t.empty}</p>
        </div>
      ) : (
        <ul className="stack">
          {servers.map((s, i) => (
            <li key={s.id}>
              <Link href={`/dashboard/servers/${s.id}`} className="card row server-link">
                <strong>{s.name}</strong>
                <span className="row">
                  <span className="muted">
                    {s.edition === "JAVA" ? "Java" : "Bedrock"} · {all.plans[s.plan]} · {s.memoryMb / 1024} GB
                  </span>
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
