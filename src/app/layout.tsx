import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { LayoutGrid, LogOut, Megaphone } from "lucide-react";
import "@fontsource-variable/inter";
import "@fontsource/jersey-10/latin.css";
import "@fontsource/jersey-10/latin-ext.css";
import { auth } from "@/auth";
import Logo from "@/components/Logo";
import PreferencesPicker from "@/components/PreferencesPicker";
import ServiceWorker from "@/components/ServiceWorker";
import HelpBubble from "@/components/HelpBubble";
import { getMessages, getPreferences } from "@/i18n/server";
import { BRAND_NAME } from "@/lib/brand";
import { siteUrl } from "@/lib/site";
import { isAdmin } from "@/lib/admin";
import { adminOnline } from "@/lib/presence";
import { getAnnouncement } from "@/lib/announcement";
import { CHAT_RATE, MAX_LENGTH } from "@/lib/support";
import { logOut } from "./actions";
import "./globals.css";

export const viewport: Viewport = { themeColor: "#0b0f14" };

export async function generateMetadata(): Promise<Metadata> {
  const [t, { locale }] = await Promise.all([getMessages(), getPreferences()]);
  const title = `${BRAND_NAME} · ${t.meta.title}`;
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: title, template: `%s · ${BRAND_NAME}` },
    description: t.meta.description,
    // Added to an iPhone's home screen, the site opens full screen as "MCHosting".
    appleWebApp: { capable: true, title: BRAND_NAME, statusBarStyle: "black" },
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
  const [{ locale, currency }, t, session, announcement] = await Promise.all([
    getPreferences(),
    getMessages(),
    auth(),
    getAnnouncement(),
  ]);
  const signedIn = !!session?.user;
  const admin = session?.user?.id ? await isAdmin(session.user.id) : false;

  return (
    <html lang={locale}>
      <body>
        <ServiceWorker />
        <header className="topbar">
          <div className={signedIn ? "topbar-inner signed-in" : "topbar-inner"}>
            <Logo />
            <nav className="topnav" aria-label={BRAND_NAME}>
              <Link href="/#gry">{t.nav.games}</Link>
              <Link href="/#cennik">{t.nav.pricing}</Link>
              <Link href="/#jak-to-dziala">{t.nav.howItWorks}</Link>
              <Link href="/#faq">{t.nav.faq}</Link>
              {/* Signed in, the bar's buttons leave room for four links only. */}
              {!signedIn && <Link href="/porownanie">{t.compare.nav}</Link>}
            </nav>
            <div className="topbar-actions">
              {signedIn ? (
                <>
                  <Link className="button small" href="/dashboard" aria-label={t.nav.dashboard}>
                    <LayoutGrid size={16} aria-hidden /> <span className="hide-phone">{t.nav.dashboard}</span>
                  </Link>
                </>
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
              {signedIn && (
                <form action={logOut} className="logout">
                  <button type="submit" className="small secondary" aria-label={t.dashboard.logOut} title={t.dashboard.logOut}>
                    <LogOut size={16} aria-hidden /> <span className="hide-tablet">{t.dashboard.logOut}</span>
                  </button>
                </form>
              )}
            </div>
          </div>
        </header>
        {announcement && (
          <div className="announcement-bar" role="status">
            <Megaphone size={16} aria-hidden /> <span>{announcement}</span>
          </div>
        )}
        {children}
        <footer className="footer">
          <div className="container footer-grid">
            <div className="stack">
              <Logo />
              <p className="muted">{t.footer.tagline}</p>
            </div>
            <div className="footer-col">
              <p className="footer-title">{t.footer.site}</p>
              <Link href="/#gry">{t.nav.games}</Link>
              <Link href="/#cennik">{t.nav.pricing}</Link>
              <Link href="/#jak-to-dziala">{t.nav.howItWorks}</Link>
              <Link href="/#faq">{t.nav.faq}</Link>
              <Link href="/porownanie">{t.compare.nav}</Link>
              <Link href="/prezent">{t.gifts.homeTitle}</Link>
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
                <>
                  <Link href="/dashboard">{t.nav.dashboard}</Link>
                  <Link href="/dashboard/invite">{t.creator.title}</Link>
                </>
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
        <HelpBubble
          t={t.support}
          signedIn={signedIn}
          admin={admin}
          adminOnline={adminOnline()}
          maxLength={MAX_LENGTH}
          rate={CHAT_RATE}
        />
      </body>
    </html>
  );
}
