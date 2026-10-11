import Link from "next/link";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { formatPrice, plans } from "@/lib/plans";

export default async function Home() {
  const [{ locale, currency }, t] = await Promise.all([getPreferences(), getMessages()]);

  return (
    <main>
      <section className="hero">
        <h1>{t.home.title}</h1>
        <p>{t.home.subtitle}</p>
        <Link className="button" href="/signup">{t.home.cta}</Link>
      </section>

      <h2>{t.home.pricingTitle}</h2>
      <ul className="plans">
        {plans.map((p) => (
          <li key={p.id} className="card stack">
            <h3>{t.plans[p.id]}</h3>
            <p className="price">
              {formatPrice(p.price[currency], currency, locale)}{" "}
              <span className="muted">{t.home.perMonth}</span>
            </p>
            <ul className="features">
              <li>{format(t.plans.ram, { gb: p.ramGb })}</li>
              <li>
                {p.maxPlayers === null
                  ? t.plans.unlimitedPlayers
                  : format(t.plans.players, { n: p.maxPlayers })}
              </li>
              <li>{p.alwaysOn ? t.plans.alwaysOn : t.plans.sleeps}</li>
              <li>
                {p.backupsKept === 0 ? t.plans.noBackups : format(t.plans.backups, { n: p.backupsKept })}
              </li>
            </ul>
          </li>
        ))}
      </ul>
    </main>
  );
}
