import Link from "next/link";
import type { Messages } from "@/i18n/messages";
import { format } from "@/i18n/messages";
import { paymentNotice } from "@/lib/testPayments";

type Props = { userId: string; all: Messages; locale: string; serverId?: string };

/**
 * Tells a customer whose payment took no money (src/lib/testPayments.ts) what
 * they got to make up for it, until they pay for real. With serverId, only
 * about that server.
 */
export default async function TestPaymentNotice({ userId, all, locale, serverId }: Props) {
  const notice = await paymentNotice(userId);
  if (!notice) return null;
  const t = all.dashboard.testPayment;
  const servers = serverId ? notice.servers.filter((s) => s.id === serverId) : notice.servers;
  if (servers.length === 0) {
    return !serverId && notice.apologyDays > 0 ? <p className="notice warn">{format(t.retry, { days: notice.apologyDays })}</p> : null;
  }
  const until = servers[0].paidUntil;
  const date = until?.toLocaleString(locale, { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Warsaw" }) ?? "";
  return (
    <p className="notice warn">
      {format(t.server, { server: servers.map((s) => s.name).join(", "), date })}{" "}
      <Link href={`/dashboard/servers/${servers[0].id}/billing`}>{t.pay}</Link>
    </p>
  );
}
