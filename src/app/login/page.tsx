import Link from "next/link";
import AuthForm from "../AuthForm";
import { logIn } from "../actions";
import { getMessages } from "@/i18n/server";

export default async function LoginPage() {
  const t = (await getMessages()).auth;
  return (
    <main className="narrow">
      <h1>{t.logInTitle}</h1>
      <AuthForm action={logIn} submitLabel={t.logInSubmit} t={t} />
      <p>
        {t.newHere} <Link href="/signup">{t.createAccount}</Link>
      </p>
    </main>
  );
}
