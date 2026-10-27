import Link from "next/link";
import { Gift, KeyRound, MessageCircle, Plus, Shield } from "lucide-react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/admin";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { addressLabel, getLiveState } from "@/lib/servers";
import { sharedServers } from "@/lib/access";
import EditionIcon from "@/components/EditionIcon";
import { GAME_ICONS } from "@/components/gameIcons";
import { offeredGames } from "@/lib/games";
import { halloweenOn } from "@/lib/halloween";
import { REFERRAL_DAYS } from "@/lib/referrals";
import { pushPublicKey } from "@/lib/push";
import AppInstall from "@/components/AppInstall";
import TestPaymentNotice from "@/components/TestPaymentNotice";

type Props = { searchParams: Promise<{ haslo?: string }> };

export default async function DashboardPage({ searchParams }: Props) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");

  const [all, servers, shared, { haslo }, admin, me, { locale }] = await Promise.all([
    getMessages(),
    db.server.findMany({
      where: { ownerId: session.user.id },
      orderBy: { createdAt: "desc" },
    }),
    sharedServers(session.user.id),
    searchParams,
    isAdmin(session.user.id),
    db.user.findUnique({ where: { id: session.user.id }, select: { bonusDays: true } }),
    getPreferences(),
  ]);
  const [states, sharedStates] = await Promise.all([
    Promise.all(servers.map((s) => getLiveState(s))),
    Promise.all(shared.map((s) => getLiveState(s))),
  ]);
  const t = all.dashboard;

  return (
    <main className="stack">
      <header className="page-head">
        <div>
          <h1>{t.title}</h1>
          <p className="muted">
            {format(t.signedInAs, { email: session.user.email ?? "" })} ·{" "}
            <Link href="/dashboard/haslo"><KeyRound size={14} aria-hidden /> {all.auth.changeTitle}</Link>
          </p>
        </div>
        <div className="row">
          {admin && <Link className="button secondary" href="/admin"><Shield size={18} aria-hidden /> {all.admin.title}</Link>}
          <Link className="button secondary" href="/dashboard/support"><MessageCircle size={18} aria-hidden /> {all.support.dashboardButton}</Link>
          <Link className="button" href="/dashboard/new"><Plus size={18} aria-hidden /> {t.createServer}</Link>
        </div>
      </header>
      {haslo === "zmienione" && <p className="notice success">{t.passwordChanged}</p>}
      <TestPaymentNotice userId={session.user.id} all={all} locale={locale} />
      {servers.length === 0 ? (
        <div className="card stack empty">
          <span className="empty-art">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/art/island.svg" alt="" width={220} height={204} />
          </span>
          <h2>{t.empty}</h2>
          <p className="muted">{t.emptyHint}</p>
          <Link className="button large" href="/dashboard/new"><Plus size={18} aria-hidden /> {t.createServer}</Link>
          <p className="muted small">{t.emptyGames}</p>
          <ul className="empty-games">
            {offeredGames(halloweenOn()).map((g) => {
              const Icon = GAME_ICONS[g.id];
              return (
                <li key={g.id}>
                  <Link className="chip" href={`/dashboard/new?game=${g.id}`}>
                    <Icon size={15} aria-hidden /> {all.server.games[g.id]}
                  </Link>
                </li>
              );
            })}
          </ul>
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
      {shared.length > 0 && (
        <section className="stack">
          <h2>{all.access.dashboardTitle}</h2>
          <ul className="server-list">
            {shared.map((s, i) => (
              <li key={s.id}>
                <Link href={`/dashboard/servers/${s.id}`} className="server-link">
                  <EditionIcon edition={s.edition} size={40} />
                  <span className="server-main">
                    <strong>{s.name}</strong>
                    <span className="mono">{addressLabel(s)}</span>
                    <span className="muted small">{format(all.access.ownerLabel, { email: s.owner.email })}</span>
                  </span>
                  <span className="server-side">
                    <span className="chip">{all.plans[s.plan]} · {s.memoryMb / 1024} GB</span>
                    <span className={`badge ${sharedStates[i]}`}>{all.server.live[sharedStates[i]]}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="card row invite-card">
        <span className="row invite-days">
          <Gift size={24} aria-hidden />
          <span className="stack-tight">
            <strong>{format(all.referrals.dashboardCard, { days: REFERRAL_DAYS })}</strong>
            {!!me?.bonusDays && <span className="muted small">{format(all.referrals.dashboardDays, { days: me.bonusDays })}</span>}
          </span>
        </span>
        <Link className="button secondary" href="/dashboard/invite">{all.referrals.nav}</Link>
      </div>
      <AppInstall labels={all.app} pushKey={pushPublicKey()} />
    </main>
  );
}
