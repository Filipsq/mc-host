import Link from "next/link";
import type { Payment } from "@prisma/client";
import type { Messages } from "@/i18n/messages";
import { format } from "@/i18n/messages";
import type { Formats } from "./format";

export type PaymentRow = Payment & { user: { id: string; email: string }; server: { id: string; name: string } | null };

type Props = { rows: PaymentRow[]; all: Messages; f: Formats; showUser?: boolean; showServer?: boolean };

export default function PaymentTable({ rows, all, f, showUser = true, showServer = true }: Props) {
  const t = all.admin;
  if (rows.length === 0) return <p className="muted">{t.noPayments}</p>;
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
              <td className="nowrap">{format(t.months, { plan: all.plans[p.plan], n: p.months })}</td>
              <td className="nowrap">{f.money(p.amount, p.currency)}</td>
              <td>
                <span className={`pay-status ${p.status.toLowerCase()}`}>{t.paymentStatuses[p.status]}</span>
              </td>
              <td className="nowrap">{p.paidAt ? f.dateTime(p.paidAt) : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
