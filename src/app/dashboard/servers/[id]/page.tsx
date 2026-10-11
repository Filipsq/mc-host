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
import EditionIcon from "@/components/EditionIcon";

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
      <Link className="back" href="/dashboard">{t.back}</Link>
      <header className="page-head">
        <div className="page-title">
          <EditionIcon edition={server.edition} size={52} />
          <div>
            <h1>{server.name}</h1>
            <div className="meta">
              <span className="chip">{server.edition === "JAVA" ? "Java" : "Bedrock"}</span>
              <span className="chip">{all.plans[server.plan]}</span>
              <span className="chip">{server.memoryMb / 1024} GB RAM</span>
            </div>
          </div>
        </div>
        <span className={`badge ${live}`}>{t.live[live]}</span>
      </header>

      {payment === "success" && <p className="notice success">{b.success}</p>}
      {payment === "cancelled" && unpaid && <p className="notice">{b.cancelled}</p>}
      {live === "awaitingPayment" && payment !== "success" && <p className="notice">{b.awaiting}</p>}
      {live === "suspended" && <p className="notice warn">{b.suspended}</p>}
      {live === "sleeping" && (
        <p className="notice">{server.edition === "JAVA" ? t.sleepingJava : t.sleepingBedrock}</p>
      )}

      <div className="card stack">
        <div className="address-card">
          <div>
            <p className="address-label">{t.address}</p>
            {server.edition === "JAVA" ? (
              <span className="address-value">{breakable(host)}</span>
            ) : (
              <span className="address-value">
                {breakable(host)} <span className="muted">· {t.port}</span> {port}
              </span>
            )}
          </div>
          <CopyButton text={host} label={t.copy} copiedLabel={t.copied} />
        </div>
        {server.edition === "BEDROCK" && <p className="muted small">{t.bedrockJoin}</p>}
        <ServerControls id={server.id} live={live} t={t} />
      </div>

      <div className="card row">
        <span>
          <strong>{all.plans[server.plan]}</strong>{" "}
          <span className="muted">
            ·{" "}
            {server.plan === "FREE"
              ? b.freeForever
              : server.paidUntil
                ? format(server.paidUntil > new Date() ? b.paidUntil : b.expiredOn, {
                    date: new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(server.paidUntil),
                  })
                : t.live.awaitingPayment}
          </span>
        </span>
        <Link className={`button${unpaid ? "" : " secondary"}`} href={`/dashboard/servers/${server.id}/billing`}>
          {unpaid ? b.pay : b.manage}
        </Link>
      </div>

      {!unpaid && <Console id={server.id} t={t} />}
      {waiting && <AutoRefresh />}
    </main>
  );
}

// Lets a long address wrap before a dot on narrow screens instead of mid-word.
function breakable(host: string) {
  return host.split(".").map((part, i) => (i === 0 ? part : <span key={i}><wbr />.{part}</span>));
}
