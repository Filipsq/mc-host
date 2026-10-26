import Link from "next/link";
import type { Payment } from "@prisma/client";
import type { Messages } from "@/i18n/messages";
import { format } from "@/i18n/messages";
import { isRemovablePayment, isTestPayment } from "@/lib/billing";
import type { Formats } from "./format";
import { DeletePaymentButton } from "./PaymentActions";
import SortableTable from "./SortableTable";
import { sortable } from "./sortable";

// gift: the gift code this payment bought (gifts.ts), when it has no server for that reason.
export type PaymentRow = Payment & { user: { id: string; email: string }; server: { id: string; name: string } | null; gift?: { code: string } | null };

type Props = { rows: PaymentRow[]; all: Messages; f: Formats; showUser?: boolean; showServer?: boolean };

export default function PaymentTable({ rows, all, f, showUser = true, showServer = true }: Props) {
  const t = all.admin;
  if (rows.length === 0) return <p className="muted">{t.noPayments}</p>;
  const removable = rows.some(isRemovablePayment);
  const table = sortable<PaymentRow>(
    [
      {
        label: t.columns.date,
        desc: true,
        value: (p) => p.createdAt,
        cell: (p) => <td className="nowrap">{f.dateTime(p.createdAt)}</td>,
      },
      showUser && {
        label: t.columns.user,
        value: (p) => p.user.email,
        cell: (p) => (
          <td>
            <Link href={`/admin/users/${p.user.id}`}>{p.user.email}</Link>
          </td>
        ),
      },
      showServer && {
        label: t.columns.server,
        value: (p) => p.server?.name ?? null,
        cell: (p) => (
          <td>
            {p.server ? (
              <Link href={`/admin/servers/${p.server.id}`}>{p.server.name}</Link>
            ) : p.gift ? (
              <span className="muted">{format(t.giftPayment, { code: p.gift.code })}</span>
            ) : (
              <span className="muted">{t.deletedServer}</span>
            )}
            {p.redeemedGiftId && <span className="muted small"> {t.paidWithGift}</span>}
          </td>
        ),
      },
      {
        label: t.columns.plan,
        value: (p) => `${all.plans[p.plan]} ${String(p.days).padStart(4, "0")}`,
        cell: (p) => (
          <td className="nowrap">
            {p.upgradeFrom
              ? format(t.upgradeRow, { from: all.plans[p.upgradeFrom], plan: all.plans[p.plan] })
              : format(t.paidDays, { plan: all.plans[p.plan], n: p.days })}
            {p.renewal && <span className="chip">{t.renewalTag}</span>}
          </td>
        ),
      },
      {
        // Different currencies only sort sensibly among themselves, so group by currency first.
        label: t.columns.amount,
        desc: true,
        value: (p) => (p.currency.toUpperCase() === "PLN" ? 0 : 1e12) + p.amount,
        cell: (p) => <td className="nowrap">{f.money(p.amount, p.currency)}</td>,
      },
      {
        label: t.columns.state,
        value: (p) => `${t.paymentStatuses[p.status]}${isTestPayment(p) ? " test" : ""}`,
        cell: (p) => (
          <td>
            <span className={`pay-status ${p.status.toLowerCase()}`}>{t.paymentStatuses[p.status]}</span>
            {isTestPayment(p) && <> <span className="chip">{t.paymentRemove.testChip}</span></>}
          </td>
        ),
      },
      {
        label: t.columns.paidAt,
        desc: true,
        value: (p) => p.paidAt,
        cell: (p) => <td className="nowrap">{p.paidAt ? f.dateTime(p.paidAt) : "–"}</td>,
      },
      removable && {
        label: t.paymentRemove.one,
        labelHidden: true,
        cell: (p) => <td>{isRemovablePayment(p) && <DeletePaymentButton id={p.id} t={t.paymentRemove} />}</td>,
      },
    ],
    rows,
    (p) => p.id,
  );
  const id = showUser && showServer ? "payments" : showUser ? "payments-of-server" : "payments-of-user";
  return (
    <div className="table-scroll card flush">
      <SortableTable id={id} locale={f.locale} {...table} />
    </div>
  );
}
