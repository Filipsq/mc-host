import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { getMessages } from "@/i18n/server";
import { format } from "@/i18n/messages";
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
  const t = all.dashboard;

  return (
    <main>
      <header className="row">
        <h1>{t.title}</h1>
        <form action={logOut}>
          <button type="submit" className="secondary">{t.logOut}</button>
        </form>
      </header>
      <p className="muted">{format(t.signedInAs, { email: session.user.email ?? "" })}</p>
      {servers.length === 0 ? (
        <div className="card">
          <p>{t.empty}</p>
        </div>
      ) : (
        <ul className="stack">
          {servers.map((s) => (
            <li key={s.id} className="card row">
              <strong>{s.name}</strong>
              <span className="muted">
                {s.edition} · {all.plans[s.plan]} · {s.memoryMb / 1024} GB · {t.status[s.status]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
