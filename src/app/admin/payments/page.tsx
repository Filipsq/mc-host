import { PaymentStatus } from "@prisma/client";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { formats } from "../format";
import PaymentTable from "../PaymentTable";

const SHOWN = 200;

type Props = { searchParams: Promise<{ status?: string }> };

export default async function AdminPayments({ searchParams }: Props) {
  await requireAdmin();
  const status = String((await searchParams).status ?? "");
  const [all, { locale }, rows] = await Promise.all([
    getMessages(),
    getPreferences(),
    db.payment.findMany({
      where: Object.hasOwn(PaymentStatus, status) ? { status: status as PaymentStatus } : {},
      orderBy: { createdAt: "desc" },
      take: SHOWN + 1,
      include: { user: { select: { id: true, email: true } }, server: { select: { id: true, name: true } } },
    }),
  ]);
  const t = all.admin;

  return (
    <>
      <form className="admin-filters">
        <select name="status" defaultValue={status} aria-label={t.status}>
          <option value="">
            {t.status}: {t.any}
          </option>
          {Object.values(PaymentStatus).map((s) => (
            <option key={s} value={s}>
              {t.paymentStatuses[s]}
            </option>
          ))}
        </select>
        <button type="submit" className="secondary">
          {t.filter}
        </button>
      </form>
      <PaymentTable rows={rows.slice(0, SHOWN)} all={all} f={formats(locale)} />
      {rows.length > SHOWN && <p className="muted small">{format(t.shown, { n: SHOWN })}</p>}
    </>
  );
}
