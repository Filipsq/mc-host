import Link from "next/link";
import { Plus, Shield } from "lucide-react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/admin";
import { getMessages } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { addressLabel, getLiveState } from "@/lib/servers";
import EditionIcon from "@/components/EditionIcon";
import { logOut } from "../actions";

type Props = { searchParams: Promise<{ haslo?: string }> };

export default async function DashboardPage({ searchParams }: Props) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");

  const [all, servers, { haslo }, admin] = await Promise.all([
    getMessages(),
    db.server.findMany({
      where: { ownerId: session.user.id },
      orderBy: { createdAt: "desc" },
    }),
    searchParams,
    isAdmin(session.user.id),
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
          {admin && <Link className="button secondary" href="/admin"><Shield size={18} aria-hidden /> {all.admin.title}</Link>}
          <Link className="button" href="/dashboard/new"><Plus size={18} aria-hidden /> {t.createServer}</Link>
          <form action={logOut}>
            <button type="submit" className="secondary">{t.logOut}</button>
          </form>
        </div>
      </header>
      {haslo === "zmienione" && <p className="notice success">{t.passwordChanged}</p>}
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
