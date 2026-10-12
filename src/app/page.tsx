import Link from "next/link";
import { Check, CreditCard, Gift, Globe, MoonStar, Smartphone, SquareTerminal } from "lucide-react";
import { auth } from "@/auth";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { formatPrice, planById, plans } from "@/lib/plans";

const featureIcons = {
  free: Gift,
  sleep: MoonStar,
  address: Globe,
  editions: Smartphone,
  console: SquareTerminal,
  payments: CreditCard,
} as const;

export default async function Home() {
  const [{ locale, currency }, t, session] = await Promise.all([getPreferences(), getMessages(), auth()]);
  const domain = process.env.GAME_DOMAIN ?? "localhost";
  const start = session?.user ? "/dashboard/new" : "/signup";
  const free = planById("FREE");
  const h = t.home;

  return (
    <main className="home">
      <section className="hero">
        <div className="container hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">{h.eyebrow}</p>
            <h1 className="display">{h.title}</h1>
            <p className="lead">{h.subtitle}</p>
            <div className="hero-actions">
              <Link className="button large" href={start}>{h.cta}</Link>
              <Link className="button large secondary" href="#cennik">{h.ctaSecondary}</Link>
            </div>
            <ul className="perks">
              {[h.perkNoCard, h.perkBlik, h.perkAddress].map((perk) => (
                <li key={perk}><Check size={16} aria-hidden /> {perk}</li>
              ))}
            </ul>
          </div>
          <div className="hero-art" aria-hidden>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="island" src="/art/island.svg" alt="" width={560} height={520} />
            <div className="hero-card">
              <span className="dot online" />
              <span className="mono">{format(h.heroAddress, { domain })}</span>
              <span className="badge online">{t.server.live.online}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <header className="section-head">
            <h2 className="display">{h.featuresTitle}</h2>
            <p className="muted">{h.featuresSubtitle}</p>
          </header>
          <ul className="feature-grid">
            {(Object.keys(featureIcons) as (keyof typeof featureIcons)[]).map((key) => {
              const Icon = featureIcons[key];
              return (
                <li key={key} className={`feature feature-${key}`}>
                  <span className="feature-icon"><Icon size={22} aria-hidden /></span>
                  <h3>{h.features[key].title}</h3>
                  <p className="muted">{format(h.features[key].text, { domain })}</p>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <section className="section alt" id="jak-to-dziala">
        <div className="container">
          <header className="section-head">
            <h2 className="display">{h.stepsTitle}</h2>
          </header>
          <ol className="steps">
            {h.steps.map((step, i) => (
              <li key={step.title} className="step">
                <span className="step-number">{i + 1}</span>
                <h3>{step.title}</h3>
                <p className="muted">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section" id="cennik">
        <div className="container">
          <header className="section-head">
            <h2 className="display">{h.pricingTitle}</h2>
            <p className="muted">{h.pricingSubtitle}</p>
          </header>
          <ul className="plans">
            {plans.map((p) => {
              const recommended = p.id === "STANDARD";
              return (
                <li key={p.id} className={`plan${recommended ? " recommended" : ""}`}>
                  {recommended && <span className="ribbon">{h.recommended}</span>}
                  <h3>{t.plans[p.id]}</h3>
                  <p className="price">
                    {formatPrice(p.price[currency], currency, locale)} <span>{h.perMonth}</span>
                  </p>
                  <ul className="features">
                    <li><Check size={16} aria-hidden /> {format(t.plans.ram, { gb: p.ramGb })}</li>
                    <li><Check size={16} aria-hidden /> {format(t.plans.disk, { gb: p.diskGb })}</li>
                    <li>
                      <Check size={16} aria-hidden />{" "}
                      {p.maxPlayers === null ? t.plans.unlimitedPlayers : format(t.plans.players, { n: p.maxPlayers })}
                    </li>
                    <li><Check size={16} aria-hidden /> {p.alwaysOn ? t.plans.alwaysOn : t.plans.sleeps}</li>
                    <li className={p.backupsKept === 0 ? "off" : undefined}>
                      <Check size={16} aria-hidden />{" "}
                      {p.backupsKept === 0 ? t.plans.noBackups : format(t.plans.backups, { n: p.backupsKept })}
                    </li>
                  </ul>
                  <Link className={`button${recommended ? "" : " secondary"}`} href={start}>
                    {p.id === "FREE" ? h.startFree : h.choosePlan}
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="pay-methods muted">
            <CreditCard size={16} aria-hidden /> {h.paymentMethods}
          </p>
        </div>
      </section>

      <section className="section alt" id="faq">
        <div className="container narrow-container">
          <header className="section-head">
            <h2 className="display">{h.faqTitle}</h2>
          </header>
          <div className="faq">
            {h.faq.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p className="muted">{format(item.a, { domain, gb: free.ramGb, n: free.maxPlayers ?? 0 })}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="cta-band">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/art/block-grass.svg" alt="" width={72} height={72} />
            <div>
              <h2 className="display">{h.ctaTitle}</h2>
              <p>{h.ctaText}</p>
            </div>
            <Link className="button large light" href={start}>{h.cta}</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
