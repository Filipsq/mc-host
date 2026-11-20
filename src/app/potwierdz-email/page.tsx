import type { Metadata } from "next";
import Link from "next/link";
import { confirmEmail } from "@/lib/emailVerify";
import { getMessages } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).emailVerify.doneTitle, robots: { index: false } };
}

type Props = { searchParams: Promise<{ t?: string }> };

/** Where the confirmation link leads (src/lib/emailVerify.ts). Works signed in or not. */
export default async function ConfirmEmailPage({ searchParams }: Props) {
  const { t: token } = await searchParams;
  const t = (await getMessages()).emailVerify;
  const ok = token ? await confirmEmail(String(token)) : null;
  return (
    <main className="wide-form stack">
      <h1>{ok ? t.doneTitle : t.badTitle}</h1>
      <p className="muted">{ok ? t.done : t.bad}</p>
      <div className="row">
        <Link className="button" href="/dashboard">{t.toPanel}</Link>
      </div>
    </main>
  );
}
