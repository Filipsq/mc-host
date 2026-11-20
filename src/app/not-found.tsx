import type { Metadata } from "next";
import Link from "next/link";
import { getMessages } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).notFound.title, robots: { index: false } };
}

/** Shown for any address that leads nowhere, inside the site's usual header and footer. */
export default async function NotFound() {
  const t = (await getMessages()).notFound;
  return (
    <main className="wide-form stack">
      <h1>{t.title}</h1>
      <p className="muted">{t.text}</p>
      <div className="row">
        <Link className="button" href="/">{t.home}</Link>
        <Link className="button secondary" href="/dashboard">{t.panel}</Link>
      </div>
    </main>
  );
}
