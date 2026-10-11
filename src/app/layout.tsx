import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/auth";
import PreferencesPicker from "@/components/PreferencesPicker";
import { getMessages, getPreferences } from "@/i18n/server";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getMessages();
  return { title: "MC Host", description: t.meta.description };
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

  return (
    <html lang={locale}>
      <body>
        <header className="topbar">
          <Link href="/" className="brand">MC Host</Link>
          <nav className="row">
            {session?.user ? (
              <Link href="/dashboard">{t.nav.dashboard}</Link>
            ) : (
              <Link href="/login">{t.nav.logIn}</Link>
            )}
            <PreferencesPicker
              locale={locale}
              currency={currency}
              labels={{ language: t.nav.language, currency: t.nav.currency }}
            />
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
