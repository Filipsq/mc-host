import Link from "next/link";
import { cache, Suspense } from "react";
import type { Server, ServerStatus } from "@prisma/client";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { heldMemoryMb, overbook, overbookOf } from "@/lib/capacity";
import { nodeById, nodes } from "@/lib/nodes";
import { nbpRates, toPln } from "@/lib/exchange";
import { saveMachineCostsAction } from "./actions";
import { PAYMENT_PERIODS, daysUntil, monthlyNet, nextPaymentOn, warsawToday } from "@/lib/machinePayments";
import { plans } from "@/lib/plans";
import { diskLimitMb } from "@/lib/disk";
import { deletionDate, isTestPayment } from "@/lib/billing";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { liveStates, machineStats } from "./data";
import { formats } from "./format";
import { aiEnabled, aiUsageThisMonth } from "@/lib/ai";
import RebuildBedrock from "./RebuildBedrock";
import { RestartAllCrashed, RestartCrashed, RestartCrashedProvider } from "./RestartCrashed";
import { signupBuckets, signupsSince, type Bucket } from "./signups";
import { activity, countSince, warsawMidnight } from "./activity";
import { REFUSAL_KINDS } from "@/lib/refusals";

const DAY = 24 * 60 * 60 * 1000;
const VAT = 0.23;
const ON_HOST: ServerStatus[] = ["RUNNING", "STOPPED", "PROVISIONING"];

// The overview is cut into parts that load on their own: what comes from our database shows at once,
// and the parts that ask the game machines (or NBP) fill in when they answer, instead of the whole page
// waiting for the slowest machine. Each part asks for what it needs; cache() makes one request ask once.
const now = cache(() => new Date());
const allServers = cache(() => db.server.findMany({ orderBy: { createdAt: "desc" } }));
const recentActivity = cache(() => activity(now()));
const signupDates = cache(() =>
  db.user.findMany({ where: { createdAt: { gte: signupsSince(now()) } }, select: { createdAt: true } }).then((rows) => rows.map((u) => u.createdAt)),
);
const paidLast31 = cache(() =>
  db.payment.findMany({
    where: { status: "PAID", paidAt: { gte: new Date(now().getTime() - 31 * DAY) } },
    select: { amount: true, currency: true, paidAt: true, stripeSessionId: true },
  }),
);
// Everything ever paid, test payments left out like in the 30-day sum. One sum per currency.
async function paidAllTime() {
  const groups = await db.payment.groupBy({
    by: ["currency"],
    where: { status: "PAID", OR: [{ stripeSessionId: null }, { NOT: { stripeSessionId: { startsWith: "cs_test_" } } }] },
    _sum: { amount: true },
  });
  return groups.map((g) => ({ currency: g.currency, amount: g._sum.amount ?? 0 }));
}
const texts = cache(async () => {
  const [all, { locale }] = await Promise.all([getMessages(), getPreferences()]);
  return { all, t: all.admin, f: formats(locale), locale };
});

export default async function AdminOverview() {
  await requireAdmin();
  const { t } = await texts();
  const o = t.overview;
  return (
    <div className="overview">
      <Suspense fallback={<Loading text={o.checking} />}>
        <Attention />
      </Suspense>

      <Suspense fallback={<div className="kpis skeleton" />}>
        <Numbers />
      </Suspense>

      <div className="overview-cols">
        <section className="stack">
          <h2>{t.activity.title}</h2>
          <Suspense fallback={<Loading text={o.loading} />}>
            <Activity />
          </Suspense>
        </section>
        <section className="stack">
          <h2>{o.machines}</h2>
          <Suspense fallback={<Loading text={o.checking} />}>
            <Machines />
          </Suspense>
        </section>
      </div>

      <Suspense fallback={<Fold title={t.signups} />}>
        <Signups />
      </Suspense>
      <Suspense fallback={<Fold title={t.costs.title} />}>
        <Costs />
      </Suspense>
      <details className="fold">
        <summary>{o.tools}</summary>
        <div className="fold-body">
          <RebuildBedrock t={t.bedrockRebuild} />
        </div>
      </details>
    </div>
  );
}

/** Crashed, over disk, stuck, ending and suspended servers in one short table; empty is a single green line. */
async function Attention() {
  const [{ all, t, f }, servers, stats] = await Promise.all([texts(), allServers(), machineStats()]);
  const live = liveStates(servers, stats);
  const at = now().getTime();
  const crashed = servers.filter((s) => live[s.id].state === "crashed");
  const overDisk = servers.filter((s) => (live[s.id].diskMb ?? 0) > diskLimitMb(s));
  const stuck = servers.filter((s) => s.status === "PROVISIONING" && s.updatedAt.getTime() < at - 10 * 60_000);
  const ending = servers
    .filter((s) => s.plan !== "FREE" && ON_HOST.includes(s.status) && s.paidUntil && s.paidUntil.getTime() < at + 3 * DAY)
    .sort((a, b) => a.paidUntil!.getTime() - b.paidUntil!.getTime());
  const suspended = servers
    .filter((s) => s.status === "SUSPENDED")
    .sort((a, b) => (a.paidUntil?.getTime() ?? 0) - (b.paidUntil?.getTime() ?? 0));
  type Group = { title: string; rows: Server[]; level: "bad" | "warn" | "info"; note?: (s: Server) => string; hint?: string };
  const groups = ([
    { title: t.crashed, rows: crashed, level: "bad" },
    {
      title: t.overDisk,
      rows: overDisk,
      level: "bad",
      note: (s) => `${f.size(live[s.id].diskMb ?? 0)} / ${f.size(diskLimitMb(s))}`,
      hint: t.overDiskHint,
    },
    { title: t.stuck, rows: stuck, level: "bad", hint: t.stuckHint },
    { title: t.ending, rows: ending, level: "warn", note: (s) => format(t.endsOn, { date: f.dateTime(s.paidUntil!) }) },
    {
      title: t.suspendedList,
      rows: suspended,
      level: "info",
      note: (s) =>
        [s.paidUntil && format(t.suspendedSince, { date: f.date(s.paidUntil) }), format(t.deletesOn, { date: f.date(deletionDate(s, now())) })]
          .filter(Boolean)
          .join(" · "),
    },
  ] satisfies Group[] as Group[]).filter((g) => g.rows.length > 0);

  if (groups.length === 0) {
    return (
      <p className="all-good">
        <span aria-hidden>✓</span> {t.attention}: {t.allGood}
        {!stats && <span className="over"> {t.agentDown}</span>}
      </p>
    );
  }
  return (
    <RestartCrashedProvider t={all.admin.restartCrashed}>
      <section className="stack tight">
        <h2>
          {t.attention}
          <span className="chips">
            {groups.map((g) => (
              <a key={g.title} href={`#uwaga-${groups.indexOf(g)}`} className={`chip ${g.level}`} title={g.hint}>
                {g.title}: {g.rows.length}
              </a>
            ))}
          </span>
          {crashed.length > 0 && <RestartAllCrashed ids={crashed.map((s) => s.id)} />}
        </h2>
        {!stats && <p className="notice warn">{t.agentDown}</p>}
        <div className="table-scroll card flush attention-scroll">
          <table className="admin-table compact">
            <tbody>
              {groups.map((g, gi) =>
                g.rows.map((s, i) => (
                  <tr key={`${gi}-${s.id}`} id={i === 0 ? `uwaga-${gi}` : undefined}>
                    <td className="fit">
                      <span className={`adot ${g.level}`} aria-hidden /> <span title={g.hint}>{g.title}</span>
                    </td>
                    <td className="fit">
                      <Link href={`/admin/servers/${s.id}`}>{s.name}</Link>
                    </td>
                    <td className="muted fit">{all.plans[s.plan]}</td>
                    <td className="muted">{g.note?.(s)}</td>
                    <td className="fit">{g.rows === crashed && <RestartCrashed id={s.id} />}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </section>
    </RestartCrashedProvider>
  );
}

/** The key numbers as one row of small tiles. Only our database, so it shows at once. */
async function Numbers() {
  const [{ all, t, f, locale }, users, newUsers, servers, paid, pending, ai, recent, allTime] = await Promise.all([
    texts(),
    db.user.count(),
    db.user.count({ where: { createdAt: { gte: new Date(now().getTime() - 7 * DAY) } } }),
    allServers(),
    paidLast31(),
    // Checkouts started but not paid yet: open ones and BLIK/Przelewy24 still being confirmed.
    db.payment.findMany({
      where: { status: "PENDING", createdAt: { gte: new Date(now().getTime() - 30 * DAY) } },
      select: { amount: true, currency: true, stripeSessionId: true },
    }),
    aiUsageThisMonth(),
    recentActivity(),
    paidAllTime(),
  ]);
  const o = t.overview;
  // Admins' test servers aren't sales, so they're counted on their own.
  const tests = servers.filter((s) => s.adminTest).length;
  const byPlan = (["FREE", "STARTER", "STANDARD", "PRO", "MAX"] as const)
    .map((plan) => ({ plan, n: servers.filter((s) => s.plan === plan && !s.adminTest).length }))
    .filter((p) => p.n > 0);
  // Test payments took no money, so they never count as revenue.
  const last30All = paid.filter((p) => p.paidAt! >= new Date(now().getTime() - 30 * DAY));
  const last30 = last30All.filter((p) => !isTestPayment(p));
  const tests30 = last30All.filter(isTestPayment);
  const thisMonth = paid.filter((p) => !isTestPayment(p) && p.paidAt! >= monthStart(now()));
  const waiting = pending.filter((p) => !isTestPayment(p));
  const usd = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(ai.usd);

  return (
    <div className="kpis">
      <Kpi label={t.users} href="/admin/users" value={String(users)} hint={format(o.newIn7, { n: newUsers })} />
      <Kpi
        label={t.activity.paying}
        value={String(recent.paying)}
        hint={format(o.share, { share: users ? f.number((recent.paying / users) * 100) : "0" })}
        title={t.activity.payingHint.replace(/\s*\(.*\)/, "")}
      />
      <Kpi
        label={t.serversTotal}
        href="/admin/servers"
        value={String(servers.length)}
        hint={[...byPlan.map((p) => `${all.plans[p.plan]} ${p.n}`), tests ? format(t.testServers, { n: tests }) : ""].filter(Boolean).join(" · ")}
      />
      <Kpi
        label={t.revenue30}
        href="/admin/payments?status=PAID"
        value={f.totals(last30) || t.none}
        side={format(t.revenueAllTime, { amount: f.totals(allTime) || t.none })}
        hint={format(t.revenueMonth, { amount: f.totals(thisMonth) || t.none })}
        title={tests30.length > 0 ? format(t.revenueTests, { amount: f.totals(tests30) }) : undefined}
        tone="good"
      />
      <Kpi
        label={format(t.revenuePending, { n: waiting.length })}
        href="/admin/payments?status=PENDING"
        value={f.totals(waiting) || t.none}
        title={t.revenuePendingHint}
        tone={waiting.length > 0 ? "warn" : undefined}
      />
      <Kpi
        label={t.aiUsage}
        value={aiEnabled() || ai.calls > 0 ? format(t.aiValue, { n: ai.calls, limit: ai.limit }) : t.aiOff}
        share={aiEnabled() ? ai.calls / ai.limit : undefined}
        hint={usd}
        title={t.aiCost.replace("{usd}", usd)}
      />
    </div>
  );
}

/** Sign-ups, new servers, payments and refusals today / 7 / 30 days, plus the last refusals folded away. */
async function Activity() {
  const [{ all, t, f }, joined, recent] = await Promise.all([texts(), signupDates(), recentActivity()]);
  const a = t.activity;
  const rows = [
    { label: a.signups, counts: countSince(joined, recent.since) },
    { label: a.newFree, counts: recent.newFree, hint: a.newFreeHint },
    { label: a.newPaying, counts: recent.newPaying, hint: a.newPayingHint },
    { label: a.payments, counts: recent.payments },
  ];
  return (
    <>
      <div className="card flush">
        <table className="admin-table compact">
          <thead>
            <tr>
              <th>{a.traffic}</th>
              <th className="num">{a.today}</th>
              <th className="num">{a.days7}</th>
              <th className="num">{a.days30}</th>
              <th className="num" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td>
                  <span className={row.hint ? "has-hint" : undefined} title={row.hint}>
                    {row.label}
                  </span>
                </td>
                {row.counts.map((n, i) => (
                  <td key={i} className="num">
                    {i === 0 ? <strong>{n}</strong> : n}
                  </td>
                ))}
                <td />
              </tr>
            ))}
          </tbody>
          <thead>
            <tr>
              <th>
                <span className="has-hint" title={a.refusalsHint}>
                  {a.refusals}
                </span>
              </th>
              <th className="num">{a.today}</th>
              <th className="num">{a.days7}</th>
              <th className="num">{a.days30}</th>
              <th className="num" title={a.people}>
                {t.overview.people}
              </th>
            </tr>
          </thead>
          <tbody>
            {REFUSAL_KINDS.map((kind) => {
              const row = recent.refusals[kind];
              return (
                <tr key={kind}>
                  <td>
                    <span className="has-hint" title={a.kindHints[kind]}>
                      {a.kinds[kind]}
                    </span>
                  </td>
                  {row.counts.map((n, i) => (
                    <td key={i} className={`num${n > 0 && kind !== "startFailed" && kind !== "createFailed" ? " over" : ""}`}>
                      {i === 0 ? <strong>{n}</strong> : n}
                    </td>
                  ))}
                  <td className="num">{row.people}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {recent.recent.length > 0 && (
        <details className="fold">
          <summary>
            {a.recent} <span className="muted">({recent.recent.length})</span>
          </summary>
          <div className="table-scroll card flush">
            <table className="admin-table compact">
              <tbody>
                {recent.recent.map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap muted">{f.dateTime(r.createdAt)}</td>
                    <td>{a.kinds[r.kind] ?? r.kind}</td>
                    <td>
                      {r.userId && (
                        <Link className="email" href={`/admin/users/${r.userId}`}>
                          {r.email ?? r.userId}
                        </Link>
                      )}
                    </td>
                    <td className="muted nowrap">
                      {[all.plans[r.plan], r.node].filter(Boolean).join(" · ")}
                      {r.serverId && (
                        <>
                          {" · "}
                          <Link href={`/admin/servers/${r.serverId}`}>{a.server}</Link>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </>
  );
}

/** One row per machine (and a total on top): sold memory, real RAM, disk, CPU and how many servers run there. */
async function Machines() {
  const [{ t, f }, servers, stats] = await Promise.all([texts(), allServers(), machineStats()]);
  if (!stats) return <p className="notice warn">{t.agentDown}</p>;
  const o = t.overview;
  const live = liveStates(servers, stats);
  const running = (s: Server) => ["online", "starting", "restarting"].includes(live[s.id].state);
  const rows = stats.machines.map((m) => {
    const node = nodeById(m.id);
    const here = servers.filter((s) => nodeById(s.node).id === m.id);
    return {
      id: m.id,
      href: `/admin/servers?node=${encodeURIComponent(m.id)}`,
      arch: node.arch,
      host: m.host,
      sold: here.reduce((sum, s) => sum + heldMemoryMb(s), 0),
      limit: Math.floor(node.memoryLimitMb * overbookOf(node)),
      servers: here.length,
      online: here.filter(running).length,
    };
  });
  const total =
    rows.length > 1
      ? {
          id: o.total,
          href: "/admin/servers",
          arch: undefined,
          host: stats.host,
          sold: rows.reduce((sum, r) => sum + r.sold, 0),
          limit: rows.reduce((sum, r) => sum + r.limit, 0),
          servers: servers.length,
          online: servers.filter(running).length,
        }
      : null;
  const soldHint = overbook() > 1 ? format(o.overbookShort, { factor: f.number(overbook()) }) : t.heldHint;

  return (
    <div className="table-scroll card flush">
      <table className="admin-table compact machines">
        <thead>
          <tr>
            <th>{t.machine}</th>
            <th>
              <span className="has-hint" title={soldHint}>
                {o.sold}
              </span>
            </th>
            <th>{o.ram}</th>
            <th>{t.disk}</th>
            <th>
              <span className="has-hint" title={t.loadHint}>
                {o.cpu}
              </span>
            </th>
            <th className="num">{o.running}</th>
          </tr>
        </thead>
        <tbody>
          {[...(total ? [total] : []), ...rows].map((r) => {
            const h = r.host;
            return (
              <tr key={r.id} className={r === total ? "sum-row" : undefined}>
                <td className="nowrap">
                  <Link href={r.href}>
                    <strong>{r.id}</strong>
                  </Link>
                  {h && (
                    <span className="muted small">
                      {" "}
                      {[r.arch && (r.arch === "arm64" ? "Arm" : "x86"), format(o.cores, { cpus: h.cpus })].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </td>
                <td>
                  <Cell value={r.limit > 0 ? `${f.gb(r.sold)} / ${f.gb(r.limit)}` : f.gb(r.sold)} share={r.limit > 0 ? r.sold / r.limit : undefined} />
                </td>
                {h ? (
                  <>
                    <td>
                      <Cell
                        value={`${f.gb(h.memoryTotalMb - h.memoryAvailableMb)} / ${f.gb(h.memoryTotalMb)}`}
                        share={1 - h.memoryAvailableMb / h.memoryTotalMb}
                      />
                    </td>
                    <td>
                      <Cell
                        value={`${f.gb(h.diskTotalMb - h.diskFreeMb)} / ${f.gb(h.diskTotalMb)}`}
                        share={h.diskTotalMb > 0 ? 1 - h.diskFreeMb / h.diskTotalMb : undefined}
                      />
                    </td>
                    <td>
                      <Cell value={`${h.load.map(f.number).join(" · ")}`} share={h.load[1] / h.cpus} />
                    </td>
                  </>
                ) : (
                  <td colSpan={3} className="over">
                    {t.machineDown}
                  </td>
                )}
                <td className="num nowrap">
                  <strong>{r.online}</strong> <span className="muted">/ {r.servers}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** New accounts per day, week and month, folded away; the header still shows today's count. */
async function Signups() {
  const [{ t, locale }, joined] = await Promise.all([texts(), signupDates()]);
  const n = now();
  const signups = signupBuckets(joined, n);
  // Rows from before the first account ever are always 0, so they go; each bucket ends where the newer one above starts.
  const first = Math.min(...joined.map((d) => d.getTime()));
  const sinceStart = (rows: Bucket[]) => rows.filter((_, i) => i === 0 || rows[i - 1].start.getTime() > first);
  const utc = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
  const dayLabel = utc({ weekday: "short", day: "numeric", month: "short" });
  const shortDay = utc({ day: "numeric", month: "short" });
  const monthLabel = utc({ month: "long", year: "numeric" });
  const tables = [
    { title: t.signupsDaily, rows: sinceStart(signups.days), label: (b: Bucket, i: number) => (i === 0 ? t.signupsToday : dayLabel.format(b.start)) },
    {
      title: t.signupsWeekly,
      rows: sinceStart(signups.weeks),
      label: (b: Bucket, i: number) =>
        i === 0 ? t.signupsThisWeek : `${shortDay.format(b.start)} – ${shortDay.format(new Date(b.start.getTime() + 6 * DAY))}`,
    },
    { title: t.signupsMonthly, rows: sinceStart(signups.months), label: (b: Bucket, i: number) => (i === 0 ? t.signupsThisMonth : monthLabel.format(b.start)) },
  ];
  return (
    <Fold
      title={t.signups}
      extra={format(t.overview.signupsSummary, { today: signups.days[0]?.count ?? 0, week: signups.weeks[0]?.count ?? 0, month: signups.months[0]?.count ?? 0 })}
    >
      <div className="signup-tables">
        {tables.map((table) => (
          <div key={table.title} className="card flush table-scroll short">
            <table className="admin-table compact">
              <thead>
                <tr>
                  <th>{table.title}</th>
                  <th className="num">{t.signupsCount}</th>
                </tr>
              </thead>
              <tbody>
                {table.rows.map((b, i) => (
                  <tr key={b.start.getTime()}>
                    <td className="nowrap">{table.label(b, i)}</td>
                    <td className="num">{i === 0 ? <strong>{b.count}</strong> : b.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </Fold>
  );
}

/**
 * Machine prices against the last 30 days' sales, and when each machine is paid for next. The header shows what's left
 * and the nearest payment; the form to change prices and dates is inside.
 */
async function Costs() {
  const [{ t, f }, costs, rates, paid] = await Promise.all([texts(), db.machineCost.findMany(), nbpRates(), paidLast31()]);
  const c = t.costs;
  const today = warsawToday(now());
  // Each machine's monthly price (net) in złoty at today's NBP rate, against the last 30 days' sales without VAT.
  // Machines are bought on different days, so both sides are counted per 30 days, not per calendar month.
  const machines = nodes().map((n) => {
    const cost = costs.find((x) => x.node === n.id);
    const next = cost?.nextPayment ? nextPaymentOn(cost.nextPayment, cost.periodMonths, today) : null;
    return {
      id: n.id,
      host: n.host,
      cost,
      pln: cost ? toPln(monthlyNet(cost), cost.currency, rates) : null,
      next,
      days: next ? daysUntil(next, today) : null,
      // What the provider takes on that day, as on its invoice.
      chargePln: cost ? toPln(cost.amount, cost.currency, rates) : null,
    };
  });
  const costPln = machines.reduce((sum, m) => sum + (m.pln ?? 0), 0);
  const costMissing = machines.some((m) => m.cost && m.pln === null);
  const last30 = paid.filter((p) => p.paidAt! >= new Date(now().getTime() - 30 * DAY) && !isTestPayment(p));
  const revenueNet = Math.round(last30.map((p) => toPln(p.amount, p.currency, rates)).reduce<number>((sum, v) => sum + (v ?? 0), 0) / (1 + VAT));
  const profit = revenueNet - costPln;
  // How many more Starter servers a month would cover the machines (its price without VAT).
  const starterNet = Math.round((plans.find((p) => p.id === "STARTER")!.price.PLN * 100) / (1 + VAT));
  const starters = profit < 0 ? Math.ceil(-profit / starterNet) : 0;
  const upcoming = machines.filter((m) => m.next).sort((x, y) => x.days! - y.days!);
  const soon = upcoming.filter((m) => m.days! <= 7);
  const soonPln = soon.reduce((sum, m) => sum + (m.chargePln ?? 0), 0);
  const nearest = upcoming[0];
  const zl = (minor: number) => f.money(minor, "PLN");
  const when = (days: number) => (days === 0 ? c.today : days === 1 ? c.tomorrow : format(c.inDays, { n: days }));
  const typedAmount = (m: (typeof machines)[number]) => f.money(m.cost!.amount, m.cost!.currency);

  return (
    <Fold
      title={c.title}
      extra={
        <>
          {format(t.overview.costsSummary, { costs: zl(costPln), revenue: zl(revenueNet) })}{" "}
          <strong className={profit < 0 ? "over" : "good"}>{zl(profit)}</strong>
          {nearest && (
            <>
              {" · "}
              <span className={nearest.days! <= 3 ? "over" : undefined}>
                {format(c.nearest, { machine: nearest.id, when: when(nearest.days!), amount: typedAmount(nearest) })}
              </span>
            </>
          )}
        </>
      }
    >
      <div className="kpis">
        <Kpi label={c.monthly} value={zl(costPln)} hint={format(c.perDay, { amount: zl(Math.round(costPln / 30)) })} />
        <Kpi label={c.revenueNet} value={zl(revenueNet)} title={c.revenueNetHint} />
        {profit < 0 ? (
          <Kpi label={c.missing} value={zl(-profit)} title={c.profitHint} hint={format(c.missingStarters, { n: starters })} tone="bad" />
        ) : (
          <Kpi label={c.profit} value={zl(profit)} title={c.profitHint} tone="good" />
        )}
        <Kpi
          label={c.soon}
          value={zl(soonPln)}
          hint={soon.length ? format(c.soonCount, { n: soon.length }) : c.soonNone}
          title={c.soonHint}
          tone={soon.some((m) => m.days! <= 3) ? "warn" : undefined}
        />
      </div>
      <p className="muted small">{c.howItWorks}</p>

      {upcoming.length > 0 && (
        <div className="card flush table-scroll">
          <table className="admin-table compact">
            <thead>
              <tr>
                <th>{c.upcoming}</th>
                <th>{c.label}</th>
                <th>{c.date}</th>
                <th className="num">{c.amount}</th>
                <th className="num">{c.inPlnCharge}</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.map((m) => (
                <tr key={m.id}>
                  <td className="fit">
                    <span className={`adot ${m.days! <= 3 ? "bad" : m.days! <= 7 ? "warn" : "info"}`} aria-hidden /> <strong>{m.id}</strong>
                  </td>
                  <td className="muted small">{m.cost!.label ?? ""}</td>
                  <td className="nowrap">
                    {f.date(m.next!)} <span className={m.days! <= 7 ? "over" : "muted"}>({when(m.days!)})</span>
                  </td>
                  <td className="num">{typedAmount(m)}</td>
                  <td className="num">{m.chargePln !== null ? zl(m.chargePln) : c.noRate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form action={saveMachineCostsAction} className="stack tight">
        <div className="card flush table-scroll">
          <table className="admin-table compact costs">
            <thead>
              <tr>
                <th>{t.machine}</th>
                <th>{c.label}</th>
                <th>{c.price}</th>
                <th>{c.period}</th>
                <th>{c.nextPayment}</th>
                <th className="num">{c.inPln}</th>
              </tr>
            </thead>
            <tbody>
              {machines.map((m) => (
                <tr key={m.id}>
                  <td>
                    <strong>{m.id}</strong>
                    <div className="muted small">{m.host}</div>
                  </td>
                  <td>
                    <input
                      className="cost-label"
                      name={`label_${m.id}`}
                      aria-label={`${c.label} ${m.id}`}
                      defaultValue={m.cost?.label ?? ""}
                      placeholder={c.labelPlaceholder}
                      maxLength={60}
                    />
                  </td>
                  <td>
                    <div className="cost-input">
                      <input
                        name={`amount_${m.id}`}
                        inputMode="decimal"
                        aria-label={`${c.price} ${m.id}`}
                        defaultValue={m.cost ? (m.cost.amount / 100).toFixed(2).replace(".", ",") : ""}
                        placeholder="0,00"
                      />
                      <select name={`currency_${m.id}`} defaultValue={m.cost?.currency ?? "EUR"} aria-label={c.currency}>
                        <option value="EUR">€</option>
                        <option value="PLN">zł</option>
                      </select>
                    </div>
                    <label className="cost-gross small">
                      <input type="checkbox" name={`gross_${m.id}`} defaultChecked={m.cost?.gross ?? true} /> {c.gross}
                    </label>
                  </td>
                  <td>
                    <select name={`period_${m.id}`} defaultValue={String(m.cost?.periodMonths ?? 1)} aria-label={`${c.period} ${m.id}`}>
                      {PAYMENT_PERIODS.map((n) => (
                        <option key={n} value={n}>
                          {format(n === 1 ? c.months1 : c.monthsN, { n })}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="date"
                      name={`next_${m.id}`}
                      aria-label={`${c.nextPayment} ${m.id}`}
                      defaultValue={m.next ? m.next.toISOString().slice(0, 10) : ""}
                    />
                  </td>
                  <td className="num">{m.pln !== null ? zl(m.pln) : m.cost ? c.noRate : <span className="muted">{c.notSet}</span>}</td>
                </tr>
              ))}
              <tr className="sum-row">
                <td colSpan={5}>
                  <strong>{c.total}</strong>
                </td>
                <td className="num">
                  <strong>{zl(costPln)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="row">
          <p className="muted small">
            {rates ? format(c.rate, { eur: f.number4(rates.perPln.EUR ?? 0), date: rates.date }) : c.rateDown}
            {costMissing && ` ${c.noRateHint}`} {c.netHint}
          </p>
          <button type="submit" className="secondary small">
            {c.save}
          </button>
        </div>
      </form>
    </Fold>
  );
}

/** A section folded away by default, with a short summary beside its title. */
function Fold({ title, extra, children }: { title: string; extra?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <details className="fold">
      <summary>
        {title}
        {extra && <span className="fold-extra">{extra}</span>}
      </summary>
      {children && <div className="fold-body stack tight">{children}</div>}
    </details>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <p className="muted small loading-line" role="status">
      <span className="spinner" aria-hidden /> {text}
    </p>
  );
}

function Kpi({
  label,
  value,
  side,
  hint,
  title,
  share,
  href,
  tone,
}: {
  label: string;
  value: string;
  /** A smaller second number shown beside the main one. */
  side?: string;
  hint?: string;
  title?: string;
  share?: number;
  href?: string;
  tone?: "good" | "warn" | "bad";
}) {
  const body = (
    <>
      <span className={`kpi-label${title ? " has-hint" : ""}`} title={title}>
        {label}
      </span>
      {side ? (
        <span className="kpi-row">
          <span className={`kpi-value${tone ? ` ${tone}` : ""}${value.length > 16 ? " long" : ""}`}>{value}</span>
          <span className="kpi-side">{side}</span>
        </span>
      ) : (
        <span className={`kpi-value${tone ? ` ${tone}` : ""}${value.length > 16 ? " long" : ""}`}>{value}</span>
      )}
      {share !== undefined && <Meter share={share} />}
      {hint && <span className="kpi-hint">{hint}</span>}
    </>
  );
  return href ? (
    <Link href={href} className="kpi card">
      {body}
    </Link>
  ) : (
    <div className="kpi card">{body}</div>
  );
}

function Cell({ value, share }: { value: string; share?: number }) {
  return (
    <div className="machine-cell">
      <span>{value}</span>
      {share !== undefined && <Meter share={share} />}
    </div>
  );
}

function Meter({ share }: { share: number }) {
  const level = share >= 0.9 ? "high" : share >= 0.75 ? "mid" : "";
  return (
    <div className={`meter ${level}`} aria-hidden>
      <span style={{ width: `${Math.min(100, Math.max(0, share * 100))}%` }} />
    </div>
  );
}

/** Midnight on the 1st of this month, Polish time. */
function monthStart(at: Date) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw" }).format(at);
  return warsawMidnight(at, `${day.slice(0, 8)}01`);
}

