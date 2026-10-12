import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { getServerState, AgentError } from "@/lib/agent";
import { addressLabel, liveStateFrom } from "@/lib/servers";
import { isServerKind } from "@/lib/modpacks";
import { diskLimitMb } from "@/lib/disk";
import { getMessages, getPreferences } from "@/i18n/server";
import { formats } from "../../format";
import PaymentTable from "../../PaymentTable";
import { DeleteButton, GiftForm } from "./AdminServerActions";

type Props = { params: Promise<{ id: string }> };

export default async function AdminServer({ params }: Props) {
  await requireAdmin();
  const { id } = await params;
  const server = await db.server.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, email: true } },
      payments: {
        orderBy: { createdAt: "desc" },
        include: { user: { select: { id: true, email: true } }, server: { select: { id: true, name: true } } },
      },
    },
  });
  if (!server) notFound();

  const [all, { locale }, state] = await Promise.all([
    getMessages(),
    getPreferences(),
    server.status === "AWAITING_PAYMENT" || server.status === "SUSPENDED"
      ? ("unknown" as const)
      : getServerState(server.id).catch((err) => (err instanceof AgentError && err.status === 404 ? ("missing" as const) : ("unknown" as const))),
  ]);
  const t = all.admin;
  const f = formats(locale);
  const live = liveStateFrom(server, state);
  const kind = server.edition === "JAVA" && isServerKind(server.kind) ? server.kind : null;

  const details: [string, React.ReactNode][] = [
    [t.columns.owner, <Link key="o" href={`/admin/users/${server.owner.id}`}>{server.owner.email}</Link>],
    [t.address, <span key="a" className="mono">{addressLabel(server)}</span>],
    [t.columns.type, [server.edition === "JAVA" ? "Java" : "Bedrock", kind && kind !== "vanilla" && (kind === "modpack" ? (server.modpackTitle ?? server.modpack) : all.server.kinds[kind])].filter(Boolean).join(" · ")],
    [t.version, server.modpackVersion ? `${server.version} (${server.modpackVersion})` : server.version],
    [t.columns.plan, `${all.plans[server.plan]} · ${f.gb(server.memoryMb)}`],
    [t.columns.disk, typeof state === "object" && state.diskMb !== undefined ? `${f.size(state.diskMb)} / ${f.size(diskLimitMb(server.plan))}` : "–"],
    [t.status, t.statuses[server.status]],
    [t.columns.paidUntil, server.plan !== "FREE" && server.paidUntil ? f.dateTime(server.paidUntil) : "–"],
    [t.reminderSent, server.reminderSentFor ? f.dateTime(server.reminderSentFor) : "–"],
    [t.columns.created, f.dateTime(server.createdAt)],
    ["ID", <span key="i" className="mono">{server.id}</span>],
    ["Port", server.port ?? "–"],
  ];

  return (
    <>
      <Link className="back" href="/admin/servers">← {t.nav.servers}</Link>
      <header className="page-head">
        <div>
          <h2>{server.name}</h2>
        </div>
        <span className={`badge ${live}`}>{all.server.live[live]}</span>
      </header>
      <div className="row">
        <Link className="button" href={`/dashboard/servers/${server.id}`}>
          {t.openPanel}
        </Link>
      </div>

      <section className="card stack">
        <h3>{t.details}</h3>
        <dl className="details">
          {details.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {server.plan !== "FREE" && (
        <section className="card stack">
          <h3>{t.gift.title}</h3>
          <p className="muted small">{t.gift.hint}</p>
          <GiftForm id={server.id} t={t.gift} />
        </section>
      )}

      <section className="stack">
        <h3>{t.payments}</h3>
        <PaymentTable rows={server.payments} all={all} f={f} showServer={false} />
      </section>

      <section className="card stack">
        <h3>{t.remove.title}</h3>
        <p className="muted small">{t.remove.hint}</p>
        <DeleteButton id={server.id} name={server.name} t={t.remove} />
      </section>
    </>
  );
}
