import Link from "next/link";
import type { Messages } from "@/i18n/messages";
import { format } from "@/i18n/messages";
import { APOLOGY_DAYS, toldCustomers, untoldCustomers } from "@/lib/testPayments";
import { stripeTestMode } from "@/lib/stripe";
import type { Formats } from "./format";
import { ApologizeButton } from "./PaymentActions";

/** Customers whose payment took no money because of the test keys, and the apology to send them. */
export default async function TestPaymentCustomers({ all, f }: { all: Messages; f: Formats }) {
  const [untold, told] = await Promise.all([untoldCustomers(), toldCustomers()]);
  if (untold.length === 0 && told.length === 0) return null;
  const t = all.admin.testPayments;
  const testMode = stripeTestMode();
  const days = APOLOGY_DAYS;
  return (
    <section className="card stack">
      <h2>{t.title}</h2>
      <p className="muted small">{format(t.hint, { days })}</p>
      {untold.length > 0 && (
        <>
          {testMode && <p className="notice warn">{t.liveFirst}</p>}
          <div>
            <ApologizeButton
              primary
              disabled={testMode}
              label={format(t.sendAll, { n: untold.length })}
              confirmText={format(t.confirmAll, { n: untold.length, days })}
            />
          </div>
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t.customer}</th>
                  <th>{t.servers}</th>
                  <th>{t.gets}</th>
                  <th aria-label={t.send} />
                </tr>
              </thead>
              <tbody>
                {untold.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <Link href={`/admin/users/${u.id}`}>{u.email}</Link>
                    </td>
                    <td>
                      {u.servers.length === 0 ? (
                        <span className="muted">{t.failedOnly}</span>
                      ) : (
                        u.servers.map((s) => (
                          <div key={s.id}>
                            <Link href={`/admin/servers/${s.id}`}>{s.name}</Link>{" "}
                            <span className="muted small">
                              {all.plans[s.plan]}
                              {s.paidUntil && ` · ${f.dateTime(s.paidUntil)}`}
                            </span>
                          </div>
                        ))
                      )}
                    </td>
                    <td>{format(u.servers.length ? t.serverGets : t.retryGets, { days })}</td>
                    <td>
                      <ApologizeButton
                        userId={u.id}
                        disabled={testMode}
                        label={t.send}
                        confirmText={format(t.confirmOne, { email: u.email, days })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">{t.deleteAfter}</p>
        </>
      )}
      {told.length > 0 && (
        <>
          <h3>{t.told}</h3>
          <ul className="stack-tight">
            {told.map((u) => (
              <li key={u.id}>
                <Link href={`/admin/users/${u.id}`}>{u.email}</Link>{" "}
                <span className="muted small">
                  {f.dateTime(u.paymentNoticeAt!)} · {u.paidSince ? t.paidSince : t.notPaid}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
