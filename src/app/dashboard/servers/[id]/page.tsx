import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { getLiveState, getOwnedServer, joinAddress } from "@/lib/servers";
import AutoRefresh from "@/components/AutoRefresh";
import ServerControls from "./ServerControls";
import Console from "./Console";
import CopyButton from "./CopyButton";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ payment?: string }>;
};

export default async function ServerPage({ params, searchParams }: Props) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [{ id }, { payment }] = await Promise.all([params, searchParams]);
  const server = await getOwnedServer(id, session.user.id);
  if (!server) notFound();

  const [all, { locale }, live] = await Promise.all([getMessages(), getPreferences(), getLiveState(server)]);
  const t = all.server;
  const b = all.billing;
  const { host, port } = joinAddress(server);
  const unpaid = live === "awaitingPayment" || live === "suspended";
  // Keep refreshing while starting, or while a just-made payment is being confirmed.
  const waiting = live === "starting" || live === "restarting" || (payment === "success" && unpaid);

  return (
    <main className="stack">
      <p><Link href="/dashboard">{t.back}</Link></p>
      <header className="row">
        <h1>{server.name}</h1>
        <span className={`badge ${live}`}>{t.live[live]}</span>
      </header>
      <p className="muted">
        {server.edition === "JAVA" ? "Java" : "Bedrock"} · {all.plans[server.plan]} · {server.memoryMb / 1024} GB RAM
      </p>

      {payment === "success" && <p className="notice success">{b.success}</p>}
      {payment === "cancelled" && unpaid && <p className="notice">{b.cancelled}</p>}
      {live === "awaitingPayment" && payment !== "success" && <p className="notice">{b.awaiting}</p>}
      {live === "suspended" && <p className="notice warn">{b.suspended}</p>}
      {live === "sleeping" && (
        <p className="notice">{server.edition === "JAVA" ? t.sleepingJava : t.sleepingBedrock}</p>
      )}

      <div className="card stack">
        {server.edition === "JAVA" ? (
          <div className="row">
            <span>{t.address}: <code>{host}</code></span>
            <CopyButton text={host} label={t.copy} copiedLabel={t.copied} />
          </div>
        ) : (
          <>
            <div className="row">
              <span>{t.address}: <code>{host}</code> · {t.port}: <code>{port}</code></span>
              <CopyButton text={host} label={t.copy} copiedLabel={t.copied} />
            </div>
            <p className="muted">{t.bedrockJoin}</p>
          </>
        )}
        <ServerControls id={server.id} live={live} t={t} />
      </div>

      <div className="card row">
        <span>
          {all.plans[server.plan]} ·{" "}
          {server.plan === "FREE"
            ? b.freeForever
            : server.paidUntil
              ? format(server.paidUntil > new Date() ? b.paidUntil : b.expiredOn, {
                  date: new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(server.paidUntil),
                })
              : t.live.awaitingPayment}
        </span>
        <Link className="button" href={`/dashboard/servers/${server.id}/billing`}>
          {unpaid ? b.pay : b.manage}
        </Link>
      </div>

      {!unpaid && <Console id={server.id} t={t} />}
      {waiting && <AutoRefresh />}
    </main>
  );
}
