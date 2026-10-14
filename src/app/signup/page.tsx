import Link from "next/link";
import AuthForm from "../AuthForm";
import { signUp } from "../actions";
import { getMessages } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { Gift, Sparkles } from "lucide-react";
import { cookies } from "next/headers";
import { REFERRAL_COOKIE, REFERRAL_DAYS, REFERRAL_MIN_DAYS } from "@/lib/referrals";

type Props = { searchParams: Promise<{ opis?: string }> };

export default async function SignUpPage({ searchParams }: Props) {
  const [all, { opis: raw }, jar] = await Promise.all([getMessages(), searchParams, cookies()]);
  // Came through a friend's invite link; sign-up checks the code itself.
  const invited = jar.has(REFERRAL_COOKIE);
  const opis = raw?.trim().slice(0, 500) || undefined;
  const t = all.auth;
  return (
    <main className="narrow stack">
      <header className="auth-head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/art/block-grass.svg" alt="" width={56} height={56} />
        <h1>{t.signUpTitle}</h1>
        <p className="muted">{t.signUpSubtitle}</p>
      </header>
      {invited && (
        <p className="notice success">
          <Gift size={16} aria-hidden /> {format(all.referrals.signupNotice, { days: REFERRAL_DAYS, min: REFERRAL_MIN_DAYS })}
        </p>
      )}
      {opis && (
        <p className="notice ai-note">
          <Sparkles size={16} aria-hidden /> {format(all.ai.signupNote, { text: opis })}
        </p>
      )}
      <AuthForm action={signUp} submitLabel={t.signUpSubmit} t={t} legal={all.legal} opis={opis} />
      <p className="auth-switch muted">
        {t.haveAccount} <Link href={opis ? `/login?opis=${encodeURIComponent(opis)}` : "/login"}>{t.logInSubmit}</Link>
      </p>
    </main>
  );
}
