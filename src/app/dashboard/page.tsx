import Link from "next/link";
import { Gift, KeyRound, MessageCircle, Plus, Shield } from "lucide-react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/admin";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { addressLabel, getLiveState, type LiveState } from "@/lib/servers";
import { getMetrics } from "@/lib/agent";
import CopyButton from "@/components/CopyButton";
import QRCode from "qrcode";
import { sharedServers } from "@/lib/access";
import EditionIcon from "@/components/EditionIcon";
import { GAME_ICONS } from "@/components/gameIcons";
import { offeredGames } from "@/lib/games";
import { halloweenOn } from "@/lib/halloween";
import { REFERRAL_DAYS } from "@/lib/referrals";
import { pushPublicKey } from "@/lib/push";
import AppInstall from "@/components/AppInstall";
import TestPaymentNotice from "@/components/TestPaymentNotice";
import { REVIEW_NAME_MAX, REVIEW_TEXT_MAX, shouldAskReview, unseenReviewReply } from "@/lib/reviews";
import ReviewAsk from "./ReviewAsk";
import ReviewReply from "./ReviewReply";

type Props = { searchParams: Promise<{ haslo?: string }> };

export default async function DashboardPage({ searchParams }: Props) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");

  const [all, servers, shared, { haslo }, admin, me, { locale }, askReview, reviewReply] = await Promise.all([
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
    shouldAskReview(session.user.id),
    unseenReviewReply(session.user.id),
  ]);
  const [states, sharedStates] = await Promise.all([
    Promise.all(servers.map((s) => getLiveState(s))),
    Promise.all(shared.map((s) => getLiveState(s))),
  ]);
  // Players on the servers that are up right now (a slow or missing answer just leaves the count out).
  const playersOn = (list: { id: string }[], live: LiveState[]) =>
    Promise.all(list.map((s, i) => (live[i] === "online" ? getMetrics(s.id, "hour").then((m) => m.online ?? m.players.length).catch(() => null) : null)));
  const [players, sharedPlayers] = await Promise.all([playersOn(servers, states), playersOn(shared, sharedStates)]);
  const t = all.dashboard;
  // The panel's address as a code a phone camera can open (for the app card on a computer).
  const qr = await QRCode.toString(`${process.env.APP_URL ?? "https://mchosting.pl"}/dashboard`, {
    type: "svg",
    margin: 1,
    color: { dark: "#0b0f14", light: "#ffffff" },
  }).catch(() => undefined);
  const dayMonth = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "Europe/Warsaw" });
  const now = new Date();

  // One server on the list: the whole card opens its panel; the address can be copied without going in.
  const card = (s: (typeof servers)[number], live: LiveState, online: number | null, owner?: string) => {
    const address = addressLabel(s);
    const meta = [
      online !== null && format(t.playersOnline, { n: online }),
      s.plan !== "FREE" && s.paidUntil && s.paidUntil > now && format(all.billing.paidUntil, { date: dayMonth.format(s.paidUntil) }),
      owner && format(all.access.ownerLabel, { email: owner }),
    ].filter(Boolean);
    return (
      <li key={s.id} className="server-card">
        <Link href={`/dashboard/servers/${s.id}`} className="server-link">
          <EditionIcon edition={s.edition} size={40} />
          <span className="server-main">
            <strong>{s.name}</strong>
            <span className="mono">{address}</span>
            {meta.length > 0 && <span className="server-meta">{meta.join(" · ")}</span>}
          </span>
          <span className="server-side">
            <span className="chip">{all.plans[s.plan]} · {s.memoryMb / 1024} GB</span>
            <span className={`badge ${live}`}>{all.server.live[live]}</span>
          </span>
        </Link>
        <span className="server-card-copy">
          <CopyButton text={address} label={t.copyAddress} copiedLabel={all.server.copied} />
        </span>
      </li>
    );
  };

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
      {reviewReply && <ReviewReply t={all.reviews} review={reviewReply} />}
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
        <ul className="server-list">{servers.map((s, i) => card(s, states[i], players[i]))}</ul>
      )}
      {shared.length > 0 && (
        <section className="stack">
          <h2>{all.access.dashboardTitle}</h2>
          <ul className="server-list">{shared.map((s, i) => card(s, sharedStates[i], sharedPlayers[i], s.owner.email))}</ul>
        </section>
      )}
      {askReview && <ReviewAsk t={all.reviews} textMax={REVIEW_TEXT_MAX} nameMax={REVIEW_NAME_MAX} />}
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
      <AppInstall labels={all.app} pushKey={pushPublicKey()} qr={qr} />
    </main>
  );
}
