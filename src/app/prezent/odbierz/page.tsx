import type { Metadata } from "next";
import Link from "next/link";
import { Gift, Plus } from "lucide-react";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { format } from "@/i18n/messages";
import { getMessages, getPreferences } from "@/i18n/server";
import { normalizeGiftCode, usableGift } from "@/lib/gifts";
import { lookupGiftAction, redeemGiftAction, type GiftErrorCode } from "../actions";
import GiftCodeForm from "../GiftCodeForm";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).gifts.redeemTitle, robots: { index: false } };
}

type Props = { searchParams: Promise<{ kod?: string; blad?: string }> };

export default async function RedeemGiftPage({ searchParams }: Props) {
  const [session, all, { locale }, { kod, blad }] = await Promise.all([getSession(), getMessages(), getPreferences(), searchParams]);
  const t = all.gifts;
  const code = normalizeGiftCode(kod ?? "").slice(0, 20);
  const found = code ? await usableGift(code) : null;
  const gift = found && "gift" in found ? found.gift : null;
  const errorKey = (blad ?? (found && "error" in found ? found.error : undefined)) as GiftErrorCode | undefined;
  const error = errorKey && errorKey in t.errors ? t.errors[errorKey] : errorKey ? t.errors.failed : null;
  const userId = session?.user?.id;
  const servers = userId && gift
    ? await db.server.findMany({ where: { ownerId: userId }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, plan: true } })
    : [];
  const until = gift?.expiresAt?.toLocaleDateString(locale, { dateStyle: "long", timeZone: "Europe/Warsaw" }) ?? "";

  return (
    <main className="wide-form stack">
      <Link className="back" href="/prezent">{t.title}</Link>
      <h1>
        <Gift size={28} aria-hidden /> {t.redeemTitle}
      </h1>
      {error && <p className="notice warn">{error}</p>}

      {gift ? (
        <>
          <div className="card stack">
            <strong className="creator-code">{gift.code}</strong>
            <p>{format(t.redeemGift, { plan: all.plans[gift.plan], days: gift.days, until })}</p>
          </div>

          {userId ? (
            <>
              <div className="card row">
                <span className="stack-tight">
                  <strong>{t.redeemNew}</strong>
                  <span className="muted small">{t.redeemNewHint}</span>
                </span>
                <Link className="button" href={`/dashboard/new?prezent=${encodeURIComponent(gift.code)}`}>
                  <Plus size={16} aria-hidden /> {t.redeemNew}
                </Link>
              </div>
              {servers.length > 0 && (
                <form action={redeemGiftAction} className="card stack">
                  <h2>{t.redeemExisting}</h2>
                  <p className="muted small">{format(t.redeemExistingHint, { plan: all.plans[gift.plan], days: gift.days })}</p>
                  <input type="hidden" name="code" value={gift.code} />
                  <div className="row invite-redeem">
                    <label className="grow">
                      {t.pickServer}
                      <select name="server" defaultValue={servers[0].id}>
                        {servers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {format(t.serverOption, { server: s.name, plan: all.plans[s.plan] })}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="submit" className="secondary">{t.addButton}</button>
                  </div>
                </form>
              )}
            </>
          ) : (
            <form action={lookupGiftAction} className="card stack">
              <p className="muted">{t.redeemSignIn}</p>
              <input type="hidden" name="code" value={gift.code} />
              <div className="row">
                <button type="submit">{t.signUp}</button>
                <button type="submit" className="secondary" name="login" value="1">{t.logIn}</button>
              </div>
            </form>
          )}
        </>
      ) : (
        <GiftCodeForm t={t} code={code} />
      )}
    </main>
  );
}
