import Link from "next/link";
import AuthForm from "../AuthForm";
import GoogleButton from "../GoogleButton";
import AuthShell from "../AuthShell";
import { googleEnabled } from "@/lib/googleAuth";
import { logIn } from "../actions";
import { getMessages } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { Sparkles } from "lucide-react";

type Props = { searchParams: Promise<{ opis?: string; error?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const [all, { opis: raw, error }] = await Promise.all([getMessages(), searchParams]);
  const t = all.auth;
  const opis = raw?.trim().slice(0, 500) || undefined;
  return (
    <AuthShell
      title={t.logInTitle}
      subtitle={t.logInSubtitle}
      below={
        <p className="auth-switch muted">
          {t.newHere} <Link href={opis ? `/signup?opis=${encodeURIComponent(opis)}` : "/signup"}>{t.createAccount}</Link>
        </p>
      }
    >
      {opis && (
        <p className="notice ai-note">
          <Sparkles size={16} aria-hidden /> {format(all.ai.signupNote, { text: opis })}
        </p>
      )}
      {/* Sent back here by a Google sign-in that didn't work. */}
      {error && <p className="error">{t.googleFailed}</p>}
      <AuthForm action={logIn} submitLabel={t.logInSubmit} t={t} forgot opis={opis} />
      {googleEnabled && (
        <>
          <p className="auth-or muted small">{t.or}</p>
          <GoogleButton t={t} legal={all.legal} opis={opis} />
        </>
      )}
    </AuthShell>
  );
}
