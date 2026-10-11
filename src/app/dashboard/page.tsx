import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { logOut } from "../actions";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const servers = await db.server.findMany({
    where: { ownerId: session.user.id },
    orderBy: { createdAt: "desc" },
  });

  return (
    <main>
      <header className="row">
        <h1>Your servers</h1>
        <form action={logOut}>
          <button type="submit" className="secondary">Log out</button>
        </form>
      </header>
      <p className="muted">Signed in as {session.user.email}</p>
      {servers.length === 0 ? (
        <div className="card">
          <p>You don&apos;t have any servers yet. Server creation is coming in the next step.</p>
        </div>
      ) : (
        <ul className="stack">
          {servers.map((s) => (
            <li key={s.id} className="card row">
              <strong>{s.name}</strong>
              <span className="muted">
                {s.edition} · {s.plan} · {s.memoryMb / 1024} GB · {s.status}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
