import Link from "next/link";
import AuthForm from "../AuthForm";
import { logIn } from "../actions";
import { getMessages } from "@/i18n/server";

export default async function LoginPage() {
  const t = (await getMessages()).auth;
  return (
    <main className="narrow stack">
      <header className="auth-head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/art/block-grass.svg" alt="" width={56} height={56} />
        <h1>{t.logInTitle}</h1>
        <p className="muted">{t.logInSubtitle}</p>
      </header>
      <AuthForm action={logIn} submitLabel={t.logInSubmit} t={t} forgot />
      <p className="auth-switch muted">
        {t.newHere} <Link href="/signup">{t.createAccount}</Link>
      </p>
    </main>
  );
}
