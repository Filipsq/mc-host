import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { TEST_PAYMENTS } from "@/lib/billing";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { formats } from "../format";
import SortableTable from "../SortableTable";
import { sortable } from "../sortable";

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
        // Test payments took no money.
        payments: { where: { status: "PAID", OR: [{ stripeSessionId: null }, { NOT: TEST_PAYMENTS }] }, select: { amount: true, currency: true } },
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
          <SortableTable
            id="users"
            locale={locale}
            {...sortable(
              [
                {
                  label: t.columns.email,
                  value: (u) => u.email,
                  cell: (u) => (
                    <td>
                      <Link href={`/admin/users/${u.id}`}>{u.email}</Link> {u.admin && <span className="chip">{t.adminChip}</span>}
                    </td>
                  ),
                },
                { label: t.columns.joined, desc: true, value: (u) => u.createdAt, cell: (u) => <td className="nowrap">{f.date(u.createdAt)}</td> },
                { label: t.columns.language, value: (u) => u.locale, cell: (u) => <td>{u.locale.toUpperCase()}</td> },
                { label: t.columns.servers, desc: true, value: (u) => u._count.servers, cell: (u) => <td>{u._count.servers}</td> },
                {
                  // Mixed currencies can't be added up; zloty decides, the rest only breaks ties.
                  label: t.columns.paid,
                  desc: true,
                  value: (u) => (u.payments.length ? u.payments.reduce((sum, p) => sum + (p.currency.toUpperCase() === "PLN" ? p.amount : 0), 0) : null),
                  cell: (u) => <td className="nowrap">{f.totals(u.payments) || "–"}</td>,
                },
              ],
              shown,
              (u) => u.id,
            )}
          />
        </div>
      )}
      {users.length > SHOWN && <p className="muted small">{format(t.shown, { n: SHOWN })}</p>}
    </>
  );
}
