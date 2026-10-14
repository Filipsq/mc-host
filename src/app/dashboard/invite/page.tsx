import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Gift } from "lucide-react";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { getMessages } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { REFERRAL_DAYS, REFERRAL_MIN_DAYS, referralCode } from "@/lib/referrals";
import CopyButton from "@/components/CopyButton";
import { redeemAction, type RedeemError } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).referrals.title };
}

type Props = { searchParams: Promise<{ dodano?: string; serwer?: string; blad?: string }> };

export default async function InvitePage({ searchParams }: Props) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  const [all, code, user, invited, paid, servers, { dodano, serwer, blad }] = await Promise.all([
    getMessages(),
    referralCode(userId),
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { bonusDays: true } }),
    db.user.count({ where: { referredById: userId } }),
    db.user.count({ where: { referredById: userId, referralRewardedAt: { not: null } } }),
    // Days go to paid servers only; a suspended one starts again.
    db.server.findMany({
      where: { ownerId: userId, plan: { not: "FREE" } },
      select: { id: true, name: true, paidUntil: true },
      orderBy: { createdAt: "asc" },
    }),
    searchParams,
  ]);
  const t = all.referrals;
  const vars = { days: REFERRAL_DAYS, min: REFERRAL_MIN_DAYS };
  const link = `${process.env.APP_URL ?? "http://localhost:3000"}/r/${code}`;
  const addedTo = servers.find((s) => s.id === serwer);
  const error = blad && blad in t.errors ? t.errors[blad as RedeemError] : null;

  return (
    <main className="stack">
      <Link className="back" href="/dashboard">← {all.dashboard.title}</Link>
      <header>
        <h1>{t.title}</h1>
        <p className="muted">{format(t.subtitle, vars)}</p>
      </header>
      {dodano && addedTo && <p className="notice success">{format(t.added, { days: dodano, server: addedTo.name })}</p>}
      {error && <p className="notice warn">{error}</p>}

      <div className="card stack">
        <p className="address-label">{t.yourLink}</p>
        <div className="address-card">
          <span className="address-value invite-link">{link}</span>
          <CopyButton text={link} label={all.server.copy} copiedLabel={all.server.copied} />
        </div>
        <p className="muted small">{t.linkHint}</p>
      </div>

      <div className="card stack">
        <div className="row invite-days">
          <Gift size={28} aria-hidden />
          <span className="stack-tight">
            <strong>{format(t.daysLeft, { days: user.bonusDays })}</strong>
            <span className="muted small">{format(t.counts, { invited, paid })}</span>
          </span>
        </div>
        {user.bonusDays > 0 && servers.length > 0 && (
          <form action={redeemAction} className="row invite-redeem">
            <label className="grow">
              {t.pickServer}
              <select name="server" defaultValue={servers[0].id}>
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">{format(t.addDays, { days: user.bonusDays })}</button>
          </form>
        )}
        {user.bonusDays > 0 && servers.length === 0 && <p className="muted small">{t.noPaidServer}</p>}
        {user.bonusDays === 0 && <p className="muted small">{t.noDaysYet}</p>}
      </div>

      <div className="card stack">
        <h2>{t.howTitle}</h2>
        <ol className="invite-steps">
          {t.steps.map((s) => (
            <li key={s}>{format(s, vars)}</li>
          ))}
        </ol>
        <p className="muted small">{format(t.rules, vars)}</p>
      </div>
    </main>
  );
}
