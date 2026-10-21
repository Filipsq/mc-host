import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowUpCircle, CalendarClock, RefreshCw } from "lucide-react";
import { getSession } from "@/lib/session";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { getOwnedServer } from "@/lib/servers";
import { addonOptions, planOptions } from "@/lib/planOptions";
import { serverAddons } from "@/lib/addons";
import { formatPrice } from "@/lib/plans";
import { priceFor } from "@/lib/billing";
import { canUpgrade } from "@/lib/upgrade";
import { RENEW_BEFORE_MS } from "@/lib/renewal";
import { PERIOD_DAYS, type PeriodDays } from "@/lib/periods";
import type { Currency } from "@/i18n/config";
import CheckoutForm from "./CheckoutForm";
import AutoRenewButton from "./AutoRenewButton";

const HOUR = 60 * 60 * 1000;

export default async function BillingPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;
  const server = await getOwnedServer(id, session.user.id);
  if (!server) notFound();

  const [t, { locale, currency }] = await Promise.all([getMessages(), getPreferences()]);
  const b = t.billing;
  const now = new Date();
  const activePaid = server.plan !== "FREE" && server.paidUntil && server.paidUntil > now;
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" });

  const status =
    server.plan === "FREE"
      ? { label: b.statuses.free, tone: "" }
      : server.status === "AWAITING_PAYMENT"
        ? { label: b.statuses.awaiting, tone: " bad" }
        : activePaid
          ? { label: b.statuses.active, tone: " ok" }
          : { label: b.statuses.suspended, tone: " bad" };
  const msLeft = activePaid ? server.paidUntil!.getTime() - now.getTime() : 0;
  const left = msLeft >= 24 * HOUR ? format(b.left, { n: Math.floor(msLeft / (24 * HOUR)) }) : format(b.leftHours, { n: Math.max(1, Math.floor(msLeft / HOUR)) });

  // What the next automatic charge will be, in the currency the card paid in.
  const renewCurrency = (server.renewCurrency ?? currency) as Currency;
  const renewDays = (PERIOD_DAYS as readonly number[]).includes(server.renewDays ?? 0) ? (server.renewDays as PeriodDays) : 30;
  const renewal =
    server.plan !== "FREE" && server.renewCard
      ? {
          on: server.autoRenew,
          text: server.autoRenew
            ? format(b.autoRenewOn, {
                card: server.renewCardLabel ?? "",
                days: renewDays,
                amount: formatPrice(priceFor(server.plan, renewDays, renewCurrency, serverAddons(server)), renewCurrency, locale),
                date: server.paidUntil ? dateTime.format(new Date(server.paidUntil.getTime() - RENEW_BEFORE_MS)) : "",
              })
            : format(b.autoRenewOff, { card: server.renewCardLabel ?? "" }),
        }
      : null;

  return (
    <main className="wide-form stack">
      <Link className="back" href={`/dashboard/servers/${server.id}`}>← {server.name}</Link>
      <h1>{b.title}</h1>

      <section className="card stack">
        <h2 className="card-title">
          <CalendarClock size={18} aria-hidden /> {t.plans[server.plan]}
        </h2>
        <dl className="plan-status">
          <dt>{b.status}</dt>
          <dd>
            <span className={`chip${status.tone}`}>{status.label}</span>
          </dd>
          {server.plan !== "FREE" && server.paidUntil && (
            <>
              <dt>{b.expires}</dt>
              <dd>
                {dateTime.format(server.paidUntil)}
                {activePaid && <span className="muted"> ({left})</span>}
              </dd>
            </>
          )}
        </dl>
      </section>

      {canUpgrade(server, now) && (
        <section className="card row">
          <span className="stack-tight">
            <strong>{b.upgradeTitle}</strong>
            <span className="muted small">{b.upgradeHint}</span>
          </span>
          <Link className="button" href={`/dashboard/servers/${server.id}/upgrade`}>
            <ArrowUpCircle size={16} aria-hidden /> {t.upgrade.title}
          </Link>
        </section>
      )}

      {server.plan !== "FREE" && (
        <section className="card row">
          <span className="stack-tight">
            <strong className="card-title">
              <RefreshCw size={16} aria-hidden /> {b.autoRenewTitle}
            </strong>
            <span className="muted small">{renewal?.text ?? b.autoRenewNone}</span>
          </span>
          {renewal && <AutoRenewButton serverId={server.id} on={!renewal.on} label={renewal.on ? b.turnOff : b.turnOn} />}
        </section>
      )}

      <CheckoutForm
        serverId={server.id}
        plans={planOptions(t, currency, (p) => p !== "FREE")}
        defaultPlan={server.plan === "FREE" ? "STARTER" : server.plan}
        note={activePaid ? `${b.extendNote} ${b.credit}` : undefined}
        t={b}
        labels={{ plan: b.choosePlan, period: t.server.period }}
        errors={t.server.errors}
        legal={t.legal}
        money={{ locale, currency }}
        autoRenew={server.autoRenew}
        addons={{
          // The own domain is for Java addresses only.
          options: addonOptions(t, currency).filter((o) => o.id !== "domain" || server.edition === "JAVA"),
          initial: serverAddons(server),
          labels: { title: t.paidAddons.pickTitle, hint: t.paidAddons.pickHint, price: t.paidAddons.price },
        }}
      />
    </main>
  );
}
