import Link from "next/link";
import type { Server, ServerStatus } from "@prisma/client";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { heldMemoryMb, memoryLimitMb, overbook, salesLimitMb } from "@/lib/capacity";
import { diskLimitMb } from "@/lib/disk";
import { deletionDate } from "@/lib/billing";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { liveStates, machineStats } from "./data";
import { formats } from "./format";
import { aiEnabled, aiUsageThisMonth } from "@/lib/ai";

const DAY = 24 * 60 * 60 * 1000;
const ON_HOST: ServerStatus[] = ["RUNNING", "STOPPED", "PROVISIONING"];

export default async function AdminOverview() {
  await requireAdmin();
  const now = new Date();
  const [all, { locale }, stats, users, newUsers, servers, paid, chats, ai] = await Promise.all([
    getMessages(),
    getPreferences(),
    machineStats(),
    db.user.count(),
    db.user.count({ where: { createdAt: { gte: new Date(now.getTime() - 7 * DAY) } } }),
    db.server.findMany({ orderBy: { createdAt: "desc" } }),
    db.payment.findMany({
      where: { status: "PAID", paidAt: { gte: new Date(now.getTime() - 31 * DAY) } },
      select: { amount: true, currency: true, paidAt: true },
    }),
    db.supportChat.findMany({
      where: { lastFromStaff: false },
      orderBy: { lastMessageAt: "asc" },
      select: { userId: true, lastMessageAt: true, user: { select: { email: true } } },
    }),
    aiUsageThisMonth(),
  ]);
  const t = all.admin;
  const f = formats(locale);
  const live = liveStates(servers, stats);

  const sold = servers.reduce((sum, s) => sum + heldMemoryMb(s), 0);
  const online = servers.filter((s) => ["online", "starting", "restarting"].includes(live[s.id].state)).length;
  const byPlan = (["FREE", "STARTER", "STANDARD", "PRO"] as const).map((plan) => ({
    plan,
    n: servers.filter((s) => s.plan === plan).length,
  }));
  const last30 = paid.filter((p) => p.paidAt! >= new Date(now.getTime() - 30 * DAY));
  const thisMonth = paid.filter((p) => p.paidAt! >= monthStart(now));

  const crashed = servers.filter((s) => live[s.id].state === "crashed");
  const overDisk = servers.filter((s) => (live[s.id].diskMb ?? 0) > diskLimitMb(s.plan));
  const stuck = servers.filter((s) => s.status === "PROVISIONING" && s.updatedAt.getTime() < now.getTime() - 10 * 60_000);
  const ending = servers
    .filter((s) => s.plan !== "FREE" && ON_HOST.includes(s.status) && s.paidUntil && s.paidUntil.getTime() < now.getTime() + 3 * DAY)
    .sort((a, b) => a.paidUntil!.getTime() - b.paidUntil!.getTime());
  const suspended = servers
    .filter((s) => s.status === "SUSPENDED")
    .sort((a, b) => (a.paidUntil?.getTime() ?? 0) - (b.paidUntil?.getTime() ?? 0));
  const groups: { title: string; rows: Server[]; note?: (s: Server) => string; hint?: string }[] = [
    { title: t.crashed, rows: crashed },
    {
      title: t.overDisk,
      rows: overDisk,
      note: (s) => `${f.size(live[s.id].diskMb ?? 0)} / ${f.size(diskLimitMb(s.plan))}`,
      hint: t.overDiskHint,
    },
    { title: t.stuck, rows: stuck, hint: t.stuckHint },
    { title: t.ending, rows: ending, note: (s) => format(t.endsOn, { date: f.dateTime(s.paidUntil!) }) },
    {
      title: t.suspendedList,
      rows: suspended,
      note: (s) =>
        [s.paidUntil && format(t.suspendedSince, { date: f.date(s.paidUntil) }), format(t.deletesOn, { date: f.date(deletionDate(s, now)) })]
          .filter(Boolean)
          .join(" · "),
    },
  ];
  const attention = groups.filter((group) => group.rows.length > 0);

  return (
    <>
      <section className="stack">
        <h2>{t.machine}</h2>
        {!stats ? (
          <p className="notice warn">{t.agentDown}</p>
        ) : (
          <div className="admin-grid">
            {overbook() > 1 ? (
              // Overbooked, what matters is how much is sold; real use is in the machine's RAM.
              <Tile
                label={t.soldLabel}
                value={format(t.soldValue, { used: f.gb(sold), limit: f.gb(salesLimitMb()) })}
                share={sold / salesLimitMb()}
                hint={format(t.overbookHint, { factor: f.number(overbook()), limit: f.gb(memoryLimitMb()) })}
              />
            ) : (
              <Tile
                label={t.held}
                value={
                  stats.memoryLimitMb > 0
                    ? format(t.heldValue, { used: f.gb(stats.memoryHeldMb), limit: f.gb(stats.memoryLimitMb) })
                    : format(t.heldNoLimit, { used: f.gb(stats.memoryHeldMb) })
                }
                share={stats.memoryLimitMb > 0 ? stats.memoryHeldMb / stats.memoryLimitMb : undefined}
                hint={`${t.heldHint} ${t.sold}: ${f.gb(sold)}.`}
              />
            )}
            <Tile
              label={t.hostMemory}
              value={format(t.hostMemoryValue, {
                used: f.gb(stats.host.memoryTotalMb - stats.host.memoryAvailableMb),
                total: f.gb(stats.host.memoryTotalMb),
              })}
              share={1 - stats.host.memoryAvailableMb / stats.host.memoryTotalMb}
            />
            <Tile
              label={t.disk}
              value={format(t.diskValue, {
                used: f.gb(stats.host.diskTotalMb - stats.host.diskFreeMb),
                total: f.gb(stats.host.diskTotalMb),
                free: f.gb(stats.host.diskFreeMb),
              })}
              share={1 - stats.host.diskFreeMb / stats.host.diskTotalMb}
            />
            <Tile
              label={t.load}
              value={format(t.loadValue, { load: stats.host.load.map(f.number).join(" · "), cpus: stats.host.cpus })}
              share={stats.host.load[1] / stats.host.cpus}
              hint={t.loadHint}
            />
          </div>
        )}
      </section>

      <section className="stack">
        <h2>{t.numbers}</h2>
        <div className="admin-grid">
          <Tile label={t.users} value={String(users)} hint={format(t.usersNew, { n: newUsers })} href="/admin/users" />
          <Tile
            label={t.serversTotal}
            value={String(servers.length)}
            hint={[stats ? format(t.serversOnline, { n: online }) : "", ...byPlan.map((p) => `${all.plans[p.plan]}: ${p.n}`)]
              .filter(Boolean)
              .join(" · ")}
            href="/admin/servers"
          />
          <Tile
            label={t.revenue30}
            value={f.totals(last30) || t.none}
            hint={format(t.revenueMonth, { amount: f.totals(thisMonth) || t.none })}
            href="/admin/payments"
          />
          <Tile
            label={t.aiUsage}
            value={aiEnabled() || ai.calls > 0 ? format(t.aiValue, { n: ai.calls, limit: ai.limit }) : t.aiOff}
            share={aiEnabled() ? ai.calls / ai.limit : undefined}
            hint={format(t.aiCost, { usd: new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(ai.usd) })}
          />
        </div>
      </section>

      <section className="stack">
        <h2>{t.attention}</h2>
        {chats.length > 0 && (
          <div className="card stack">
            <h3>
              <Link href="/admin/support">{all.support.admin.waitingTitle}</Link> <span className="muted">({chats.length})</span>
            </h3>
            <ul className="attention-list">
              {chats.map((c) => (
                <li key={c.userId}>
                  <Link className="break" href={`/admin/support/${c.userId}`}>{c.user.email}</Link>
                  <span className="muted small">{format(all.support.admin.since, { date: f.dateTime(c.lastMessageAt) })}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {attention.length === 0 && chats.length === 0 ? (
          <p className="muted">{t.allGood}</p>
        ) : (
          attention.map((group) => (
            <div key={group.title} className="card stack">
              <h3>
                {group.title} <span className="muted">({group.rows.length})</span>
              </h3>
              {group.hint && <p className="muted small">{group.hint}</p>}
              <ul className="attention-list">
                {group.rows.map((s) => (
                  <li key={s.id}>
                    <Link href={`/admin/servers/${s.id}`}>{s.name}</Link>
                    <span className="muted small">
                      {[all.plans[s.plan], group.note?.(s)].filter(Boolean).join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </>
  );
}

function Tile({ label, value, hint, share, href }: { label: string; value: string; hint?: string; share?: number; href?: string }) {
  const level = share === undefined ? "" : share >= 0.9 ? "high" : share >= 0.75 ? "mid" : "";
  return (
    <div className="card stat">
      <p className="stat-label">{href ? <Link href={href}>{label}</Link> : label}</p>
      <p className="stat-value">{value}</p>
      {share !== undefined && (
        <div className={`meter ${level}`} aria-hidden>
          <span style={{ width: `${Math.min(100, Math.max(0, share * 100))}%` }} />
        </div>
      )}
      {hint && <p className="muted small">{hint}</p>}
    </div>
  );
}

/** Midnight on the 1st of this month, Polish time. */
function monthStart(now: Date) {
  const part = (type: string, parts: Intl.DateTimeFormatPart[]) => parts.find((p) => p.type === type)!.value;
  const ym = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit" }).formatToParts(now);
  const day = `${part("year", ym)}-${part("month", ym)}-01`;
  const offset = new Intl.DateTimeFormat("en", { timeZone: "Europe/Warsaw", timeZoneName: "longOffset" }).formatToParts(
    new Date(`${day}T00:00:00Z`),
  );
  return new Date(`${day}T00:00:00${part("timeZoneName", offset).replace("GMT", "") || "Z"}`);
}
