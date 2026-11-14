import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Globe, PackagePlus } from "lucide-react";
import { getSession } from "@/lib/session";
import { isAdmin } from "@/lib/admin";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { getOwnedServer, javaHost } from "@/lib/servers";
import { formatPrice } from "@/lib/plans";
import { addonOptions } from "@/lib/planOptions";
import { ADDONS, ADDON_SPECS, DOMAIN_DAYS, addonCost, addonFits, canBuyAddons, domainPaidFor, hasOwnDomain, serverAddons, type AddonId } from "@/lib/addons";
import { paysafecardEnabled } from "@/lib/cashbill";
import { BuyAddonsForm, BuyDomainForm, DomainForm, RemoveAddonButton } from "./AddonForms";

// The server's paid add-ons (src/lib/addons.ts): the ones it has, turning one
// off, buying more for the rest of the period, and setting the own domain.
export default async function AddonsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;
  const server = await getOwnedServer(id, session.user.id);
  if (!server) notFound();

  const [all, { locale, currency }] = await Promise.all([getMessages(), getPreferences()]);
  const t = all.paidAddons;
  // An admin's own test server: buying is offered for 0 too.
  const adminTest = server.adminTest && (await isAdmin(session.user.id));
  const money = (n: number) => formatPrice(n, currency, locale);
  const have = serverAddons(server);
  // The own domain is for Java addresses only.
  const options = addonOptions(all, currency).filter((o) => addonFits(o.id, server.edition));
  const prices = Object.fromEntries(options.map((o) => [o.id, money(o.monthly)]));
  const missing = options.filter((o) => !have.includes(o.id));
  const buyable = canBuyAddons(server);
  // What every set of missing add-ons costs now, so the total shown is what's charged.
  const costs: Record<string, string> = {};
  if (buyable) {
    for (let mask = 1; mask < 1 << missing.length; mask++) {
      const set = missing.filter((_, i) => mask & (1 << i)).map((o) => o.id);
      const ordered = ADDONS.filter((a) => set.includes(a)) as AddonId[];
      costs[ordered.join(",")] = money(addonCost(ordered, server.paidUntil!, currency).amount);
    }
  }
  const date = server.paidUntil ? new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(server.paidUntil) : "";

  return (
    <div className="wide-form stack">
      <h2>{t.title}</h2>
      {server.plan !== "FREE" && <p className="muted">{t.pageHint}</p>}

      {server.plan === "FREE" ? (
        <>
          {server.edition === "JAVA" && (
            <section className="card stack">
              <h2 className="card-title">
                <Globe size={18} aria-hidden /> {t.free.title}
              </h2>
              <p className="muted">{t.free.intro}</p>
              {domainPaidFor(server) && (
                <p className="notice success">{format(t.free.paidUntil, { date: new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(server.domainUntil!) })}</p>
              )}
              <BuyDomainForm
                serverId={server.id}
                price={money(ADDON_SPECS.domain.price[currency])}
                days={DOMAIN_DAYS}
                paysafecard={paysafecardEnabled(currency)}
                again={domainPaidFor(server)}
                t={t.free}
                billing={all.billing}
                legal={all.legal}
                errors={all.server.errors}
                adminTest={adminTest}
              />
            </section>
          )}
          {hasOwnDomain(server) && (
            <section className="card stack">
              <h2 className="card-title">
                <Globe size={18} aria-hidden /> {t.domain.title}
              </h2>
              <DomainForm serverId={server.id} current={server.customDomain} target={javaHost(server)} address={javaHost(server)} t={t.domain} />
            </section>
          )}
          <section className="card row">
            <span className="muted">{server.edition === "JAVA" ? t.freeOther : t.freePlan}</span>
            <Link className="button" href={`/dashboard/servers/${server.id}/billing`}>
              {all.billing.manage}
            </Link>
          </section>
        </>
      ) : (
        <>
          {have.length > 0 && (
            <section className="card stack">
              <h2 className="card-title">
                <PackagePlus size={18} aria-hidden /> {t.have}
              </h2>
              <ul className="addon-list">
                {have.map((a) => (
                  <li key={a}>
                    <span className="stack-tight">
                      <strong>{t.names[a]}</strong>
                      <span className="muted small">
                        {prices[a] && format(t.price, { price: prices[a] })} · {t.hints[a]}
                      </span>
                    </span>
                    <RemoveAddonButton serverId={server.id} addon={a} label={t.remove} confirm={format(t.removeConfirm, { name: t.names[a] })} />
                  </li>
                ))}
              </ul>
              <p className="muted small">{t.removeNote}</p>
            </section>
          )}

          {hasOwnDomain(server) && (
            <section className="card stack">
              <h2 className="card-title">
                <Globe size={18} aria-hidden /> {t.domain.title}
              </h2>
              <DomainForm serverId={server.id} current={server.customDomain} target={javaHost(server)} address={javaHost(server)} t={t.domain} />
            </section>
          )}

          {!buyable ? (
            <section className="card row">
              <span className="muted">{t.payFirst}</span>
              <Link className="button" href={`/dashboard/servers/${server.id}/billing`}>
                {all.billing.pay}
              </Link>
            </section>
          ) : missing.length === 0 ? (
            <p className="muted small">{t.noneLeft}</p>
          ) : (
            <BuyAddonsForm
              serverId={server.id}
              options={missing}
              costs={costs}
              prices={prices}
              t={t}
              billing={all.billing}
              legal={all.legal}
              errors={all.server.errors}
              hint={format(t.buyHint, { date })}
              adminTest={adminTest}
            />
          )}
        </>
      )}
    </div>
  );
}
