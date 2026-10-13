import Link from "next/link";
import AuthForm from "../AuthForm";
import { logIn } from "../actions";
import { getMessages } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { Sparkles } from "lucide-react";

type Props = { searchParams: Promise<{ opis?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const [all, { opis: raw }] = await Promise.all([getMessages(), searchParams]);
  const t = all.auth;
  const opis = raw?.trim().slice(0, 500) || undefined;
  return (
    <main className="narrow stack">
      <header className="auth-head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/art/block-grass.svg" alt="" width={56} height={56} />
        <h1>{t.logInTitle}</h1>
        <p className="muted">{t.logInSubtitle}</p>
      </header>
      {opis && (
        <p className="notice ai-note">
          <Sparkles size={16} aria-hidden /> {format(all.ai.signupNote, { text: opis })}
        </p>
      )}
      <AuthForm action={logIn} submitLabel={t.logInSubmit} t={t} forgot opis={opis} />
      <p className="auth-switch muted">
        {t.newHere} <Link href={opis ? `/signup?opis=${encodeURIComponent(opis)}` : "/signup"}>{t.createAccount}</Link>
      </p>
    </main>
  );
}
