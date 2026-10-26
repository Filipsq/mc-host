import type { Metadata } from "next";
import Link from "next/link";
import { Gift } from "lucide-react";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { planOptions } from "@/lib/planOptions";
import { GIFT_VALID_DAYS } from "@/lib/gifts";
import CopyButton from "@/components/CopyButton";
import AutoRefresh from "@/components/AutoRefresh";
import GiftBuyForm from "./GiftBuyForm";
import GiftCodeForm from "./GiftCodeForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = (await getMessages()).gifts;
  return { title: t.title, description: t.subtitle };
}

type Props = { searchParams: Promise<{ kupiono?: string; anulowano?: string }> };

export default async function GiftPage({ searchParams }: Props) {
  const [session, all, { locale, currency }, { kupiono, anulowano }] = await Promise.all([
    getSession(),
    getMessages(),
    getPreferences(),
    searchParams,
  ]);
  const t = all.gifts;
  const userId = session?.user?.id;
  const bought = userId
    ? await db.giftCode.findMany({ where: { buyerId: userId }, orderBy: { createdAt: "desc" }, take: 50 })
    : [];
  // Shown only once Stripe confirmed, so codes waiting for payment are listed but not given out.
  const visible = bought.filter((g) => g.paidAt || g.id === kupiono);
  const waiting = !!kupiono && bought.some((g) => g.id === kupiono && !g.paidAt);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "Europe/Warsaw" });
  const now = new Date();

  return (
    <main className="wide-form stack">
      <h1>
        <Gift size={28} aria-hidden /> {t.title}
      </h1>
      <p className="muted">{t.subtitle}</p>

      {kupiono && <p className="notice success">{t.boughtNotice}</p>}
      {anulowano && <p className="notice">{t.cancelled}</p>}
      {waiting && <AutoRefresh everyMs={5000} />}

      <div className="card stack">
        <h2>{t.howTitle}</h2>
        <ol className="invite-steps">
          {t.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </div>

      {visible.length > 0 && (
        <div className="card stack">
          <h2>{t.boughtTitle}</h2>
          <div className="table-scroll">
            <table className="creator-table">
              <thead>
                <tr>
                  <th>{t.columns.code}</th>
                  <th>{t.columns.plan}</th>
                  <th>{t.columns.status}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((g) => (
                  <tr key={g.id}>
                    <td>
                      {g.paidAt ? (
                        <span className="row">
                          <strong className="creator-code">{g.code}</strong>
                          <CopyButton text={g.code} label={all.server.copy} copiedLabel={all.server.copied} />
                        </span>
                      ) : (
                        "…"
                      )}
                    </td>
                    <td>{format(t.giftPlan, { plan: all.plans[g.plan], days: g.days })}</td>
                    <td>
                      {g.redeemedAt ? (
                        <span className="muted small">{format(t.statusUsed, { date: date.format(g.redeemedAt) })}</span>
                      ) : !g.paidAt ? (
                        <span className="muted small">{t.statusPending}</span>
                      ) : g.expiresAt && g.expiresAt <= now ? (
                        <span className="muted small">{t.statusExpired}</span>
                      ) : (
                        <span className="badge online">{format(t.statusReady, { date: g.expiresAt ? date.format(g.expiresAt) : "" })}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {userId ? (
        <GiftBuyForm
          plans={planOptions(all, currency, (p) => p !== "FREE")}
          defaultPlan="STARTER"
          t={t}
          billing={all.billing}
          legal={all.legal}
          labels={{ plan: all.billing.choosePlan, period: all.server.period }}
          validity={format(t.validity, { days: GIFT_VALID_DAYS })}
          money={{ locale, currency }}
        />
      ) : (
        <div className="card stack">
          <h2>{t.buyTitle}</h2>
          <p className="muted">{t.signInToBuy}</p>
          <div className="row">
            <Link className="button" href="/signup">{t.signUp}</Link>
            <Link className="button secondary" href="/login">{t.logIn}</Link>
          </div>
        </div>
      )}

      <GiftCodeForm t={t} />
    </main>
  );
}
