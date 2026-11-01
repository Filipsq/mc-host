import Link from "next/link";
import type { Plan } from "@prisma/client";
import { Check, CreditCard, Flame, Gift, Globe, MoonStar, Package, Smartphone, Sparkles, SquareTerminal } from "lucide-react";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { formatPrice, planById, plans } from "@/lib/plans";
import { periodPrice } from "@/lib/periods";
import { gamePluginTitles, offeredGames } from "@/lib/games";
import { CURATED_PACKS } from "@/lib/modpacks";
import { KNOWN_PLUGINS, PLUGIN_SETS } from "@/lib/plugins";
import RamCalculator from "@/components/RamCalculator";
import PackCarousel from "@/components/PackCarousel";
import CurseforgeTop from "@/components/CurseforgeTop";
import HeroAddress from "@/components/HeroAddress";
import Clouds from "@/components/Clouds";
import PauseOffscreen from "@/components/PauseOffscreen";
import EditionIcon from "@/components/EditionIcon";
import HalloweenGames from "@/components/HalloweenGames";
import { FeatureArt, GameArt, StepArt } from "@/components/HomeArt";
import { getPackArt } from "@/lib/modrinth";
import { topCurseforgePacks } from "@/lib/curseforge";
import { DESCRIPTION_MAX, aiEnabled } from "@/lib/ai";
import { halloweenOn } from "@/lib/halloween";
import HalloweenBand from "@/components/HalloweenBand";
import { HuntPumpkin } from "@/components/Halloween";
import { REFERRAL_COOKIE, REFERRAL_DAYS, REFERRAL_MIN_DAYS } from "@/lib/referrals";

const featureIcons = {
  free: Gift,
  editions: Smartphone,
  sleep: MoonStar,
  address: Globe,
  console: SquareTerminal,
  payments: CreditCard,
} as const;


export default async function Home() {
  const [{ locale, currency }, t, session, packArt, cfPacks, jar] = await Promise.all([
    getPreferences(),
    getMessages(),
    auth(),
    getPackArt(CURATED_PACKS.map((p) => p.slug)),
    topCurseforgePacks(),
    cookies(),
  ]);
  // Came through a friend's invite link (/r/<code>) and hasn't signed up yet.
  const invited = !session?.user && jar.has(REFERRAL_COOKIE);
  const domain = process.env.GAME_DOMAIN ?? "localhost";
  const start = session?.user ? "/dashboard/new" : "/signup";
  const free = planById("FREE");
  const h = t.home;
  // The pumpkin hunt (lib/halloween.ts): one pumpkin hidden in each of these spots.
  const halloween = halloweenOn();
  const pumpkin = (id: string) => halloween && <HuntPumpkin id={id} label={t.halloween.pumpkin} className={`hunt-${id}`} />;

  return (
    <main className="home">
      <PauseOffscreen />
      <section className="hero">
        <Clouds />
        <div className="container hero-grid">
          <div className="hero-copy">
            {invited && (
              <p className="notice success invite-banner">
                <Gift size={18} aria-hidden />
                <span>{format(t.referrals.homeBanner, { days: REFERRAL_DAYS, min: REFERRAL_MIN_DAYS })}</span>
                <Link className="button small" href="/signup">{t.referrals.homeBannerButton}</Link>
              </p>
            )}
            <p className="eyebrow">{h.eyebrow}</p>
            <h1 className="display">{h.title}</h1>
            <p className="lead">{h.subtitle}</p>
            {aiEnabled() && (
              // Signed out, this goes through sign-up first; the description comes along.
              <form className="ai-hero" action={session?.user ? "/dashboard/new" : "/signup"} method="get">
                <label className="ai-hero-label" htmlFor="ai-hero-input">
                  <span className="ai-badge">{t.ai.badge}</span> {t.ai.heroTitle}
                </label>
                <div className="ai-hero-bar">
                  <Sparkles className="ai-hero-icon" size={20} aria-hidden />
                  <input id="ai-hero-input" name="opis" required maxLength={DESCRIPTION_MAX} placeholder={t.ai.heroPlaceholder} autoComplete="off" />
                  <button type="submit">{t.ai.heroButton}</button>
                </div>
                <p className="muted small">{t.ai.heroHint}</p>
              </form>
            )}
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
            <span className="island-shadow" />
            <div className="island">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/art/island.svg" alt="" width={560} height={520} />
            </div>
            {pumpkin("hero")}
            <div className="hero-card">
              <span className="dot online" />
              <HeroAddress names={h.heroNames} domain={domain} />
              <span className="badge online">{t.server.live.online}</span>
            </div>
          </div>
        </div>
      </section>

      {halloween && (
        <HalloweenBand t={t.halloween} signedIn={!!session?.user}>
          <HalloweenGames />
        </HalloweenBand>
      )}

      <section className="section hunt-spot">
        {pumpkin("features")}
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
                  <FeatureArt kind={key} art={h.art} domain={domain} online={t.server.live.online} zero={formatPrice(0, currency, locale)} />
                  <h3><span className="feature-icon"><Icon size={18} aria-hidden /></span> {h.features[key].title}</h3>
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
                <StepArt step={i} art={h.art} signUp={t.nav.signUp} domain={domain} />
                <span className="step-number">{i + 1}</span>
                <h3>{step.title}</h3>
                <p className="muted">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section hunt-spot" id="gry">
        {pumpkin("games")}
        <div className="container stack-large">
          <header className="section-head">
            <h2 className="display">{h.gamesTitle}</h2>
            <p className="muted">{h.gamesSubtitle}</p>
          </header>
          <ul className="game-grid">
            {offeredGames(halloween).map((g) => {
              const extras = gamePluginTitles(g.id);
              return (
                <li key={g.id} className="feature game-card">
                  <GameArt id={g.id} />
                  <h3>{t.server.games[g.id]}</h3>
                  <p className="muted">{h.gameShort[g.id]}</p>
                  {extras.length > 0 && (
                    <ul className="plugin-chips" aria-label={t.server.withPlugins.split(":")[0]}>
                      {extras.map((name) => <li key={name}>{name}</li>)}
                    </ul>
                  )}
                  <span className="ram-pill">{format(t.server.ramFrom, { gb: g.ramGb })}</span>
                </li>
              );
            })}
          </ul>

          <div className="stack">
            <h3 className="subsection-title"><Package size={20} aria-hidden /> {h.packsTitle}</h3>
            <p className="muted">{h.packsSubtitle}</p>
            <PackCarousel
              t={t.server}
              planNames={t.plans}
              art={packArt}
              label={h.packsTitle}
              link={(slug) => (session?.user ? `/dashboard/new?pack=${slug}` : "/signup")}
            />
            <p className="muted small">{h.packsMore}</p>
          </div>

          {cfPacks && cfPacks.length > 0 && (
            <div className="stack" id="curseforge">
              <h3 className="subsection-title"><Flame size={20} aria-hidden /> {h.cfTitle}</h3>
              <p className="muted">{h.cfSubtitle}</p>
              <CurseforgeTop
                packs={cfPacks}
                t={h}
                server={t.server}
                planNames={t.plans}
                locale={locale}
                link={(slug) => (session?.user ? `/dashboard/new?cf=${slug}` : "/signup")}
              />
              <p className="muted small">
                <a href="https://www.curseforge.com/minecraft/search?class=modpacks" target="_blank" rel="noreferrer">
                  {h.cfSource}
                </a>
              </p>
            </div>
          )}

          <div className="stack">
            <h3 className="subsection-title">{h.setsTitle}</h3>
            <p className="muted">{h.setsSubtitle}</p>
            <ul className="pack-grid">
              {PLUGIN_SETS.map((set) => (
                <li key={set.id} className="pack-card">
                  <strong>{t.plugins.setNames[set.id]}</strong>
                  <span className="muted small">{t.plugins.setHints[set.id]}</span>
                  <span className="small">{set.plugins.map((p) => KNOWN_PLUGINS[p].title).join(" · ")}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="invite-band terraria-band" id="terraria">
            <span className="invite-band-icon"><EditionIcon edition="TERRARIA" size={36} /></span>
            <div>
              <h3>{h.terrariaTitle}</h3>
              <p className="muted">{h.terrariaText}</p>
            </div>
            <Link className="button large secondary" href={session?.user ? "/dashboard/new?game=terraria" : "/signup"}>
              {h.terrariaCta}
            </Link>
          </div>

          {(["VALHEIM", "HYTALE"] as const).map((ed) => {
            const g = ed === "VALHEIM" ? "valheim" : "hytale";
            return (
              <div key={ed} className="invite-band terraria-band" id={g}>
                <span className="invite-band-icon"><EditionIcon edition={ed} size={36} /></span>
                <div>
                  <h3>{h.otherGames[g].title}</h3>
                  <p className="muted">{h.otherGames[g].text}</p>
                </div>
                <Link className="button large secondary" href={session?.user ? `/dashboard/new?game=${g}` : "/signup"}>
                  {h.otherGames[g].cta}
                </Link>
              </div>
            );
          })}
        </div>
      </section>

      <section className="section alt hunt-spot" id="cennik">
        {pumpkin("pricing")}
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
                  <p className="price-note">
                    {p.price[currency] > 0
                      ? format(h.longerPeriod, { price: formatPrice(periodPrice(p.price[currency], 90), currency, locale) })
                      : h.freeForever}
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
                    <li><Check size={16} aria-hidden /> {t.plans.support}</li>
                    <li><Check size={16} aria-hidden /> {t.plans.ddos}</li>
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
          <p className="compare-link">
            <Link href="/porownanie">{h.compareLink}</Link>
          </p>
          <RamCalculator
            t={h}
            planNames={t.plans}
            prices={Object.fromEntries(plans.map((p) => [p.id, formatPrice(p.price[currency], currency, locale)])) as Record<Plan, string>}
            locale={locale}
            start={start}
          />
        </div>
      </section>

      <section className="section invite-section" id="polecaj">
        <div className="container">
          <div className="invite-band">
            <span className="invite-band-icon"><Gift size={30} aria-hidden /></span>
            <div>
              <h2>{h.inviteTitle}</h2>
              <p className="muted">{format(h.inviteText, { days: REFERRAL_DAYS, min: REFERRAL_MIN_DAYS })}</p>
            </div>
            <Link className="button large" href={session?.user ? "/dashboard/invite" : "/signup"}>
              {session?.user ? h.inviteButton : h.inviteSignUp}
            </Link>
          </div>
        </div>
      </section>

      <section className="section invite-section" id="prezent">
        <div className="container">
          <div className="invite-band">
            <span className="invite-band-icon"><Gift size={30} aria-hidden /></span>
            <div>
              <h2>{t.gifts.homeTitle}</h2>
              <p className="muted">{t.gifts.homeText}</p>
            </div>
            <Link className="button large" href="/prezent">
              {t.gifts.homeButton}
            </Link>
          </div>
        </div>
      </section>

      <section className="section hunt-spot" id="faq">
        {pumpkin("faq")}
        <div className="container narrow-container">
          <header className="section-head">
            <h2 className="display">{h.faqTitle}</h2>
          </header>
          <div className="faq">
            {h.faq.map((item) => (
              <details key={item.q}>
                <summary>{item.q}</summary>
                <p className="muted">
                  {format(item.a, { domain, gb: free.ramGb, n: free.maxPlayers ?? 0, days: REFERRAL_DAYS, min: REFERRAL_MIN_DAYS })}
                </p>
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
