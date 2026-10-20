import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getMessages } from "@/i18n/server";
import { ChangePasswordForm } from "@/app/ResetForms";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).auth.changeTitle };
}

export default async function ChangePasswordPage() {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const all = await getMessages();
  const t = all.auth;
  return (
    <main className="stack">
      <Link className="back" href="/dashboard">← {all.dashboard.title}</Link>
      <header className="page-head">
        <div>
          <h1>{t.changeTitle}</h1>
          <p className="muted">{t.changeSubtitle}</p>
        </div>
      </header>
      <ChangePasswordForm t={t} email={session.user.email ?? ""} />
      <p className="muted small">{t.forgotCurrent}</p>
    </main>
  );
}
