import Link from "next/link";
import AuthForm from "../AuthForm";
import { signUp } from "../actions";
import { getMessages } from "@/i18n/server";

export default async function SignUpPage() {
  const t = (await getMessages()).auth;
  return (
    <main className="narrow">
      <h1>{t.signUpTitle}</h1>
      <AuthForm action={signUp} submitLabel={t.signUpSubmit} t={t} />
      <p>
        {t.haveAccount} <Link href="/login">{t.logInSubmit}</Link>
      </p>
    </main>
  );
}
