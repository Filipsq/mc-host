import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { accountSummary } from "@/lib/accountDeletion";
import { formats } from "@/app/admin/format";
import DeleteAccountForm from "@/components/DeleteAccountForm";
import { deleteOwnAccountAction } from "@/app/actions";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).accountDelete.title };
}

/** The customer deletes their whole account (src/lib/accountDeletion.ts). Linked from the password page. */
export default async function DeleteAccountPage() {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const [all, { locale }, user, summary] = await Promise.all([
    getMessages(),
    getPreferences(),
    db.user.findUnique({ where: { id: session.user.id }, select: { email: true, passwordHash: true, admin: true } }),
    accountSummary(session.user.id),
  ]);
  if (!user) redirect("/login");
  const t = all.accountDelete;
  const f = formats(locale);
  const paidLines = summary.paid.map(
    (s) => format(t.paidUntil, { name: s.name, plan: all.plans[s.plan], date: f.date(s.paidUntil!) }) + (s.autoRenew ? `, ${t.autoRenew}` : ""),
  );
  return (
    <main className="stack">
      <Link className="back" href="/dashboard/haslo">← {all.auth.changeTitle}</Link>
      <header className="page-head">
        <div>
          <h1>{t.title}</h1>
          <p className="muted">{t.subtitle}</p>
        </div>
      </header>
      <section className="card stack danger-zone">
        {user.admin ? (
          <p className="notice warn">{t.errors.admin}</p>
        ) : (
          <DeleteAccountForm
            action={deleteOwnAccountAction}
            email={user.email}
            servers={summary.servers}
            paidLines={paidLines}
            needsPassword={Boolean(user.passwordHash)}
            t={t}
          />
        )}
      </section>
    </main>
  );
}
