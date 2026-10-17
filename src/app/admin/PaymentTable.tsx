import Link from "next/link";
import type { Payment } from "@prisma/client";
import type { Messages } from "@/i18n/messages";
import { format } from "@/i18n/messages";
import { isRemovablePayment, isTestPayment } from "@/lib/billing";
import type { Formats } from "./format";
import { DeletePaymentButton } from "./PaymentActions";

export type PaymentRow = Payment & { user: { id: string; email: string }; server: { id: string; name: string } | null };

type Props = { rows: PaymentRow[]; all: Messages; f: Formats; showUser?: boolean; showServer?: boolean };

export default function PaymentTable({ rows, all, f, showUser = true, showServer = true }: Props) {
  const t = all.admin;
  if (rows.length === 0) return <p className="muted">{t.noPayments}</p>;
  const removable = rows.some(isRemovablePayment);
  return (
    <div className="table-scroll card flush">
      <table className="admin-table">
        <thead>
          <tr>
            <th>{t.columns.date}</th>
            {showUser && <th>{t.columns.user}</th>}
            {showServer && <th>{t.columns.server}</th>}
            <th>{t.columns.plan}</th>
            <th>{t.columns.amount}</th>
            <th>{t.columns.state}</th>
            <th>{t.columns.paidAt}</th>
            {removable && <th aria-label={t.paymentRemove.one} />}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td className="nowrap">{f.dateTime(p.createdAt)}</td>
              {showUser && (
                <td>
                  <Link href={`/admin/users/${p.user.id}`}>{p.user.email}</Link>
                </td>
              )}
              {showServer && (
                <td>
                  {p.server ? <Link href={`/admin/servers/${p.server.id}`}>{p.server.name}</Link> : <span className="muted">{t.deletedServer}</span>}
                </td>
              )}
              <td className="nowrap">{format(t.paidDays, { plan: all.plans[p.plan], n: p.days })}</td>
              <td className="nowrap">{f.money(p.amount, p.currency)}</td>
              <td>
                <span className={`pay-status ${p.status.toLowerCase()}`}>{t.paymentStatuses[p.status]}</span>
                {isTestPayment(p) && <> <span className="chip">{t.paymentRemove.testChip}</span></>}
              </td>
              <td className="nowrap">{p.paidAt ? f.dateTime(p.paidAt) : "–"}</td>
              {removable && <td>{isRemovablePayment(p) && <DeletePaymentButton id={p.id} t={t.paymentRemove} />}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
