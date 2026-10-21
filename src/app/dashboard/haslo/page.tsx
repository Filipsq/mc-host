import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
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
  // Made with Google and never given a password: it's set without the current one.
  const user = await db.user.findUnique({ where: { id: session.user.id }, select: { passwordHash: true } });
  const hasPassword = Boolean(user?.passwordHash);
  return (
    <main className="stack">
      <Link className="back" href="/dashboard">← {all.dashboard.title}</Link>
      <header className="page-head">
        <div>
          <h1>{hasPassword ? t.changeTitle : t.setTitle}</h1>
          <p className="muted">{hasPassword ? t.changeSubtitle : t.setSubtitle}</p>
        </div>
      </header>
      <ChangePasswordForm t={t} email={session.user.email ?? ""} hasPassword={hasPassword} />
      {hasPassword && <p className="muted small">{t.forgotCurrent}</p>}
    </main>
  );
}
