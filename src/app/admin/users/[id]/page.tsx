import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { getMessages, getPreferences } from "@/i18n/server";
import { liveStates, machineStats } from "../../data";
import { formats } from "../../format";
import PaymentTable from "../../PaymentTable";
import ServerTable from "../../ServerTable";
import ResetLink from "./ResetLink";
import { format } from "@/i18n/messages";
import { ADMIN_LINK_HOURS } from "@/lib/passwordReset";

type Props = { params: Promise<{ id: string }> };

export default async function AdminUser({ params }: Props) {
  await requireAdmin();
  const { id } = await params;
  const user = await db.user.findUnique({
    where: { id },
    include: {
      servers: { orderBy: { createdAt: "desc" }, include: { owner: { select: { id: true, email: true } } } },
      payments: {
        orderBy: { createdAt: "desc" },
        include: { user: { select: { id: true, email: true } }, server: { select: { id: true, name: true } } },
      },
    },
  });
  if (!user) notFound();
  const [all, { locale }, stats] = await Promise.all([
    getMessages(),
    getPreferences(),
    user.servers.length > 0 ? machineStats() : null,
  ]);
  const t = all.admin;
  const f = formats(locale);
  const paid = user.payments.filter((p) => p.status === "PAID");

  const details: [string, string][] = [
    [t.columns.joined, f.dateTime(user.createdAt)],
    [t.columns.language, user.locale.toUpperCase()],
    [t.termsAccepted, user.termsAcceptedAt ? f.dateTime(user.termsAcceptedAt) : "–"],
    [t.columns.paid, f.totals(paid) || "–"],
    ["ID", user.id],
  ];

  return (
    <>
      <Link className="back" href="/admin/users">← {t.nav.users}</Link>
      <header className="page-head">
        <h2 className="break">{user.email}</h2>
        <div className="row">
          {user.admin && <span className="chip">{t.adminChip}</span>}
          <Link className="button secondary small" href={`/admin/support/${user.id}`}>
            <MessageCircle size={16} aria-hidden /> {all.support.admin.open}
          </Link>
        </div>
      </header>
      <section className="card stack">
        <h3>{t.details}</h3>
        <dl className="details">
          {details.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="card stack">
        <h3>{t.resetLink.title}</h3>
        <p className="muted">{format(t.resetLink.hint, { hours: ADMIN_LINK_HOURS })}</p>
        <ResetLink userId={user.id} t={t.resetLink} />
      </section>
      <section className="stack">
        <h3>{t.nav.servers}</h3>
        <ServerTable rows={user.servers} live={liveStates(user.servers, stats)} all={all} f={f} showOwner={false} />
      </section>
      <section className="stack">
        <h3>{t.payments}</h3>
        <PaymentTable rows={user.payments} all={all} f={f} showUser={false} />
      </section>
    </>
  );
}
