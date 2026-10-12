import type { Metadata } from "next";
import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import "@fontsource-variable/inter";
import "@fontsource/jersey-10/latin.css";
import "@fontsource/jersey-10/latin-ext.css";
import { auth } from "@/auth";
import Logo from "@/components/Logo";
import PreferencesPicker from "@/components/PreferencesPicker";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { BRAND_NAME } from "@/lib/brand";
import { formatPrice, planById } from "@/lib/plans";
import { siteUrl } from "@/lib/site";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const [t, { locale, currency }] = await Promise.all([getMessages(), getPreferences()]);
  // "from" the cheapest paid plan, in the visitor's currency.
  const from = formatPrice(planById("STARTER").price[currency], currency, locale);
  const title = `${BRAND_NAME} · ${format(t.meta.title, { price: from })}`;
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: title, template: `%s · ${BRAND_NAME}` },
    description: t.meta.description,
    openGraph: {
      type: "website",
      siteName: BRAND_NAME,
      title,
      description: t.meta.description,
      locale: locale === "pl" ? "pl_PL" : "en_US",
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [{ locale, currency }, t, session] = await Promise.all([
    getPreferences(),
    getMessages(),
    auth(),
  ]);
  const signedIn = !!session?.user;

  return (
    <html lang={locale}>
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <Logo />
            <nav className="topnav" aria-label={BRAND_NAME}>
              <Link href="/#cennik">{t.nav.pricing}</Link>
              <Link href="/#jak-to-dziala">{t.nav.howItWorks}</Link>
              <Link href="/#faq">{t.nav.faq}</Link>
            </nav>
            <div className="topbar-actions">
              {signedIn ? (
                <Link className="button small" href="/dashboard" aria-label={t.nav.dashboard}>
                  <LayoutGrid size={16} aria-hidden /> <span className="hide-phone">{t.nav.dashboard}</span>
                </Link>
              ) : (
                <>
                  <Link className="topbar-login" href="/login">{t.nav.logIn}</Link>
                  <Link className="button small hide-phone" href="/signup">{t.nav.signUp}</Link>
                </>
              )}
              <PreferencesPicker
                locale={locale}
                currency={currency}
                labels={{ language: t.nav.language, currency: t.nav.currency }}
              />
            </div>
          </div>
        </header>
        {children}
        <footer className="footer">
          <div className="container footer-grid">
            <div className="stack">
              <Logo />
              <p className="muted">{t.footer.tagline}</p>
            </div>
            <div className="footer-col">
              <p className="footer-title">{t.footer.site}</p>
              <Link href="/#cennik">{t.nav.pricing}</Link>
              <Link href="/#jak-to-dziala">{t.nav.howItWorks}</Link>
              <Link href="/#faq">{t.nav.faq}</Link>
            </div>
            <div className="footer-col">
              <p className="footer-title">{t.legal.footerTitle}</p>
              <Link href="/regulamin">{t.legal.terms}</Link>
              <Link href="/polityka-prywatnosci">{t.legal.privacy}</Link>
              <Link href="/kontakt">{t.legal.contact}</Link>
            </div>
            <div className="footer-col">
              <p className="footer-title">{t.footer.account}</p>
              {signedIn ? (
                <Link href="/dashboard">{t.nav.dashboard}</Link>
              ) : (
                <>
                  <Link href="/login">{t.nav.logIn}</Link>
                  <Link href="/signup">{t.nav.signUp}</Link>
                </>
              )}
            </div>
          </div>
          <div className="container footer-bottom">
            <span>© {new Date().getFullYear()} {BRAND_NAME}</span>
            <span>{t.footer.disclaimer}</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
