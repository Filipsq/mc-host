import Link from "next/link";
import AuthForm from "../AuthForm";
import { signUp } from "../actions";
import { getMessages } from "@/i18n/server";

export default async function SignUpPage() {
  const all = await getMessages();
  const t = all.auth;
  return (
    <main className="narrow stack">
      <header className="auth-head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/art/block-grass.svg" alt="" width={56} height={56} />
        <h1>{t.signUpTitle}</h1>
        <p className="muted">{t.signUpSubtitle}</p>
      </header>
      <AuthForm action={signUp} submitLabel={t.signUpSubmit} t={t} legal={all.legal} />
      <p className="auth-switch muted">
        {t.haveAccount} <Link href="/login">{t.logInSubmit}</Link>
      </p>
    </main>
  );
}
