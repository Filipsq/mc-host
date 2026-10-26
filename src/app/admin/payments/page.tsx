import { PaymentStatus } from "@prisma/client";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { TEST_PAYMENTS } from "@/lib/billing";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { formats } from "../format";
import PaymentTable from "../PaymentTable";
import { DeleteTestPaymentsButton } from "../PaymentActions";
import TestPaymentCustomers from "../TestPaymentCustomers";
import { untoldCustomers } from "@/lib/testPayments";

const SHOWN = 200;

type Props = { searchParams: Promise<{ status?: string }> };

export default async function AdminPayments({ searchParams }: Props) {
  await requireAdmin();
  const status = String((await searchParams).status ?? "");
  const [all, { locale }, rows, tests, untold] = await Promise.all([
    getMessages(),
    getPreferences(),
    db.payment.findMany({
      where: Object.hasOwn(PaymentStatus, status) ? { status: status as PaymentStatus } : {},
      orderBy: { createdAt: "desc" },
      take: SHOWN + 1,
      include: { user: { select: { id: true, email: true } }, server: { select: { id: true, name: true } }, gift: { select: { code: true } } },
    }),
    db.payment.count({ where: TEST_PAYMENTS }),
    untoldCustomers(),
  ]);
  const t = all.admin;
  const f = formats(locale);

  return (
    <>
      <TestPaymentCustomers all={all} f={f} />
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
      {/* The test payments are the only record of whose payment didn't go through: keep them until everyone is told. */}
      {tests > 0 && untold.length === 0 && (
        <div className="stack">
          <p className="muted small">{t.paymentRemove.hint}</p>
          <div>
            <DeleteTestPaymentsButton n={tests} t={t.paymentRemove} />
          </div>
        </div>
      )}
      <PaymentTable rows={rows.slice(0, SHOWN)} all={all} f={f} />
      {rows.length > SHOWN && <p className="muted small">{format(t.shown, { n: SHOWN })}</p>}
    </>
  );
}
