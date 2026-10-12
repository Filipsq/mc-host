import type { Metadata } from "next";
import Link from "next/link";
import { NewPasswordForm } from "../ResetForms";
import { getMessages } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { findValidReset } from "@/lib/passwordReset";

export async function generateMetadata(): Promise<Metadata> {
  // The token is in this page's URL: don't pass it on to other sites.
  return { title: (await getMessages()).auth.newPasswordTitle, referrer: "no-referrer" };
}

type Props = { searchParams: Promise<{ token?: string }> };

export default async function NewPasswordPage({ searchParams }: Props) {
  const { token = "" } = await searchParams;
  const [t, reset] = await Promise.all([getMessages().then((m) => m.auth), findValidReset(token)]);
  return (
    <main className="narrow stack">
      <header className="auth-head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/art/block-grass.svg" alt="" width={56} height={56} />
        <h1>{reset ? t.newPasswordTitle : t.linkInvalidTitle}</h1>
        <p className="muted">{reset ? format(t.newPasswordFor, { email: reset.user.email }) : t.linkInvalidText}</p>
      </header>
      {reset ? (
        <NewPasswordForm t={t} token={token} email={reset.user.email} />
      ) : (
        <Link className="button" href="/reset-hasla">
          {t.requestNewLink}
        </Link>
      )}
      <p className="auth-switch muted">
        <Link href="/login">{t.backToLogin}</Link>
      </p>
    </main>
  );
}
