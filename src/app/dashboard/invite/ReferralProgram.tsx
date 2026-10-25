import Link from "next/link";
import { Gift, Trophy } from "lucide-react";
import { db } from "@/lib/db";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { REFERRAL_DAYS, REFERRAL_MIN_DAYS, referralCode } from "@/lib/referrals";
import { CREATOR_DISCOUNT, CREATOR_GOAL, CREATOR_MIN_DAYS, FREE_STARTER_DAYS, freeStarterDaysFor, maskEmail } from "@/lib/creator";
import CopyButton from "@/components/CopyButton";
import { redeemAction, redeemFreeStarterAction, type FreeStarterError, type RedeemError } from "./actions";

export type ProgramSearch = { dodano?: string; serwer?: string; blad?: string; nagroda?: string };

/**
 * "Polecaj i zarabiaj": the user's creator code and invite link, who bought a
 * server with the code and the free Starters it earned (creator.ts), and the
 * days from invited friends (referrals.ts). Shown on /dashboard/invite and in
 * a server panel's menu; `back` is the page the forms return to.
 */
export default async function ReferralProgram({ userId, search, back }: { userId: string; search: ProgramSearch; back: string }) {
  const [all, { locale }, code, user, invited, paid, servers, bought] = await Promise.all([
    getMessages(),
    getPreferences(),
    referralCode(userId),
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { bonusDays: true, creatorCount: true, freeStarters: true } }),
    db.user.count({ where: { referredById: userId } }),
    db.user.count({ where: { referredById: userId, referralRewardedAt: { not: null } } }),
    // Days go to paid servers only; a suspended one starts again.
    db.server.findMany({
      where: { ownerId: userId, plan: { not: "FREE" } },
      select: { id: true, name: true, plan: true },
      orderBy: { createdAt: "asc" },
    }),
    // Servers bought with the code (not ones still waiting for their first payment).
    db.server.findMany({
      where: { creatorId: userId, status: { not: "AWAITING_PAYMENT" } },
      select: { id: true, name: true, plan: true, createdAt: true, creatorCountedAt: true, owner: { select: { email: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);
  const t = all.referrals;
  const c = all.creator;
  const vars = { days: REFERRAL_DAYS, min: REFERRAL_MIN_DAYS };
  const cvars = { percent: CREATOR_DISCOUNT, goal: CREATOR_GOAL, days: FREE_STARTER_DAYS, min: CREATOR_MIN_DAYS };
  const link = `${process.env.APP_URL ?? "http://localhost:3000"}/r/${code}`;
  const { dodano, serwer, blad, nagroda } = search;
  const addedTo = servers.find((s) => s.id === serwer);
  const error = blad && blad in t.errors ? t.errors[blad as RedeemError] : null;
  const rewardError = nagroda && nagroda in c.errors ? c.errors[nagroda as FreeStarterError] : null;
  const toNext = user.creatorCount % CREATOR_GOAL;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  return (
    <>
      {dodano && addedTo && <p className="notice success">{format(t.added, { days: dodano, server: addedTo.name })}</p>}
      {(error || rewardError) && <p className="notice warn">{error ?? rewardError}</p>}

      <div className="card stack">
        <p className="address-label">{c.yourCode}</p>
        <div className="address-card">
          <span className="address-value creator-code">{code.toUpperCase()}</span>
          <CopyButton text={code.toUpperCase()} label={all.server.copy} copiedLabel={all.server.copied} />
        </div>
        <p className="address-label">{c.yourLink}</p>
        <div className="address-card">
          <span className="address-value invite-link">{link}</span>
          <CopyButton text={link} label={all.server.copy} copiedLabel={all.server.copied} />
        </div>
        <p className="muted small">{c.codeHint}</p>
      </div>

      <div className="card stack">
        <div className="row invite-days">
          <Trophy size={28} aria-hidden />
          <span className="stack-tight creator-progress">
            <strong>
              {c.progressTitle}: {format(c.progress, { n: toNext, goal: CREATOR_GOAL })}
            </strong>
            <span className="meter creator-meter" aria-hidden>
              <span style={{ width: `${(toNext / CREATOR_GOAL) * 100}%` }} />
            </span>
            <span className="muted small">{format(c.total, { n: user.creatorCount })}</span>
          </span>
        </div>
        {user.freeStarters > 0 ? (
          <>
            <p className="notice success">{format(c.rewardsLeft, { n: user.freeStarters })}</p>
            <div className="row">
              <Link className="button" href="/dashboard/new">
                {c.createFree}
              </Link>
            </div>
            {servers.length > 0 && (
              <form action={redeemFreeStarterAction} className="row invite-redeem">
                <input type="hidden" name="back" value={back} />
                <label className="grow">
                  {c.orAdd}
                  <select name="server" defaultValue={servers[0].id}>
                    {servers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {format(c.serverOption, { server: s.name, plan: all.plans[s.plan], days: freeStarterDaysFor(s.plan) })}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="secondary">
                  {c.addButton}
                </button>
              </form>
            )}
          </>
        ) : (
          <p className="muted small">{format(c.noRewards, cvars)}</p>
        )}
      </div>

      <div className="card stack">
        <h2>{c.buyersTitle}</h2>
        {bought.length === 0 ? (
          <p className="muted">{c.buyersEmpty}</p>
        ) : (
          <div className="table-scroll">
            <table className="creator-table">
              <thead>
                <tr>
                  <th>{c.columns.server}</th>
                  <th>{c.columns.buyer}</th>
                  <th>{c.columns.plan}</th>
                  <th>{c.columns.date}</th>
                  <th>{c.columns.status}</th>
                </tr>
              </thead>
              <tbody>
                {bought.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>{maskEmail(s.owner.email)}</td>
                    <td>{all.plans[s.plan]}</td>
                    <td>{date.format(s.createdAt)}</td>
                    <td>
                      {s.creatorCountedAt ? (
                        <span className="badge online">{c.counted}</span>
                      ) : (
                        <span className="muted small">{format(c.notYet, cvars)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card stack">
        <h2>{t.title}</h2>
        <p className="muted">{format(t.subtitle, vars)}</p>
        <div className="row invite-days">
          <Gift size={28} aria-hidden />
          <span className="stack-tight">
            <strong>{format(t.daysLeft, { days: user.bonusDays })}</strong>
            <span className="muted small">{format(t.counts, { invited, paid })}</span>
          </span>
        </div>
        {user.bonusDays > 0 && servers.length > 0 && (
          <form action={redeemAction} className="row invite-redeem">
            <input type="hidden" name="back" value={back} />
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
        <h2>{c.howTitle}</h2>
        <ol className="invite-steps">
          {c.steps.map((s) => (
            <li key={s}>{format(s, cvars)}</li>
          ))}
        </ol>
        <p className="muted small">{format(c.rules, cvars)}</p>
        <p className="muted small">{format(t.rules, vars)}</p>
      </div>
    </>
  );
}
