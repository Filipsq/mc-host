import type { Metadata } from "next";
import Link from "next/link";
import { ResetRequestForm } from "../ResetForms";
import { getMessages } from "@/i18n/server";
import { RESET_LINK_MINUTES } from "@/lib/passwordReset";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).auth.resetTitle };
}

export default async function ResetPasswordPage() {
  const t = (await getMessages()).auth;
  return (
    <main className="narrow stack">
      <header className="auth-head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/art/block-grass.svg" alt="" width={56} height={56} />
        <h1>{t.resetTitle}</h1>
        <p className="muted">{t.resetSubtitle}</p>
      </header>
      <ResetRequestForm t={t} minutes={RESET_LINK_MINUTES} />
      <p className="auth-switch muted">
        <Link href="/login">{t.backToLogin}</Link>
      </p>
    </main>
  );
}
