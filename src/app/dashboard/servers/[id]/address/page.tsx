import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Globe, Pencil } from "lucide-react";
import { getSession } from "@/lib/session";
import { isAdmin } from "@/lib/admin";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { getOwnedServer, javaHost, joinAddress } from "@/lib/servers";
import { formatPrice } from "@/lib/plans";
import { addonOptions } from "@/lib/planOptions";
import { ADDON_SPECS, DOMAIN_DAYS, addonCost, canBuyAddons, domainPaidFor, hasOwnDomain } from "@/lib/addons";
import { paysafecardEnabled } from "@/lib/cashbill";
import { BuyAddonsForm, BuyDomainForm, DomainForm } from "../addons/AddonForms";
import AddressForm from "./AddressForm";

// "Zmień adres" on Przegląd (Fiq, 2026-11-16): the own domain for 5 zł comes
// first, then the free change of the <name>.mchosting.pl address. Java only.
export default async function AddressPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;
  const server = await getOwnedServer(id, session.user.id);
  if (!server) notFound();
  if (server.edition !== "JAVA") redirect(`/dashboard/servers/${server.id}/settings`);

  const [all, { locale, currency }] = await Promise.all([getMessages(), getPreferences()]);
  const t = all.paidAddons;
  const a = t.address;
  const adminTest = server.adminTest && (await isAdmin(session.user.id));
  const price = formatPrice(ADDON_SPECS.domain.price[currency], currency, locale);
  const date = (d: Date) => new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(d);
  const own = hasOwnDomain(server);
  const free = server.plan === "FREE";
  const buyable = canBuyAddons(server);
  const domainOption = addonOptions(all, currency).filter((o) => o.id === "domain");

  return (
    <div className="wide-form stack">
      <h2>{a.title}</h2>
      <p className="muted">
        {a.now} <strong>{joinAddress(server).host}</strong>
      </p>

      {own ? (
        <section className="card stack">
          <h2 className="card-title">
            <Globe size={18} aria-hidden /> {t.domain.title}
          </h2>
          {free && domainPaidFor(server) && <p className="notice success">{format(t.free.paidUntil, { date: date(server.domainUntil!) })}</p>}
          <DomainForm serverId={server.id} current={server.customDomain} target={javaHost(server)} address={javaHost(server)} t={t.domain} />
        </section>
      ) : (
        <section className="card stack domain-promo">
          <h2 className="card-title">
            <Globe size={18} aria-hidden /> {format(a.promoTitle, { price })}
          </h2>
          <p>{format(a.promoText, { address: javaHost(server) })}</p>
          <p className="muted small">{a.promoOwn}</p>
          {free ? (
            <>
              <p className="muted small">{format(a.promoFree, { price, days: DOMAIN_DAYS })}</p>
              <BuyDomainForm
                serverId={server.id}
                price={price}
                days={DOMAIN_DAYS}
                paysafecard={paysafecardEnabled(currency)}
                again={false}
                t={t.free}
                billing={all.billing}
                legal={all.legal}
                errors={all.server.errors}
                adminTest={adminTest}
              />
            </>
          ) : !buyable ? (
            <div className="row">
              <span className="muted">{t.payFirst}</span>
              <Link className="button" href={`/dashboard/servers/${server.id}/billing`}>
                {all.billing.pay}
              </Link>
            </div>
          ) : null}
        </section>
      )}
      {!own && !free && buyable && (
        <BuyAddonsForm
          serverId={server.id}
          options={domainOption}
          costs={{ domain: formatPrice(addonCost(["domain"], server.paidUntil!, currency).amount, currency, locale) }}
          prices={{ domain: format(t.flatPrice, { price }) }}
          t={t}
          billing={all.billing}
          legal={all.legal}
          errors={all.server.errors}
          hint={format(a.promoPaid, { price, date: date(server.paidUntil!) })}
          adminTest={adminTest}
          title={t.names.domain}
          preselect={["domain"]}
        />
      )}

      <section className="card stack">
        <h2 className="card-title">
          <Pencil size={18} aria-hidden /> {a.freeTitle}
        </h2>
        <p className="muted small">{a.freeText}</p>
        <AddressForm
          serverId={server.id}
          name={server.name}
          subdomain={server.subdomain ?? ""}
          domain={process.env.GAME_DOMAIN ?? "mchosting.pl"}
          save={a.save}
          t={all.settings.rename}
        />
      </section>
    </div>
  );
}
