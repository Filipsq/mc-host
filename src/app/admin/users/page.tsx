import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { formats } from "../format";

const SHOWN = 200;

type Props = { searchParams: Promise<{ q?: string }> };

export default async function AdminUsers({ searchParams }: Props) {
  await requireAdmin();
  const search = String((await searchParams).q ?? "").trim();
  const [all, { locale }, users] = await Promise.all([
    getMessages(),
    getPreferences(),
    db.user.findMany({
      where: search ? { email: { contains: search, mode: "insensitive" } } : {},
      orderBy: { createdAt: "desc" },
      take: SHOWN + 1,
      select: {
        id: true,
        email: true,
        createdAt: true,
        locale: true,
        admin: true,
        _count: { select: { servers: true } },
        payments: { where: { status: "PAID" }, select: { amount: true, currency: true } },
      },
    }),
  ]);
  const t = all.admin;
  const f = formats(locale);
  const shown = users.slice(0, SHOWN);

  return (
    <>
      <form className="admin-filters" role="search">
        <input name="q" defaultValue={search} placeholder={t.searchUsers} aria-label={t.search} />
        <button type="submit" className="secondary">
          {t.search}
        </button>
      </form>
      {shown.length === 0 ? (
        <p className="muted">{t.noUsers}</p>
      ) : (
        <div className="table-scroll card flush">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t.columns.email}</th>
                <th>{t.columns.joined}</th>
                <th>{t.columns.language}</th>
                <th>{t.columns.servers}</th>
                <th>{t.columns.paid}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.id}>
                  <td>
                    <Link href={`/admin/users/${u.id}`}>{u.email}</Link> {u.admin && <span className="chip">{t.adminChip}</span>}
                  </td>
                  <td className="nowrap">{f.date(u.createdAt)}</td>
                  <td>{u.locale.toUpperCase()}</td>
                  <td>{u._count.servers}</td>
                  <td className="nowrap">{f.totals(u.payments) || "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {users.length > SHOWN && <p className="muted small">{format(t.shown, { n: SHOWN })}</p>}
    </>
  );
}
