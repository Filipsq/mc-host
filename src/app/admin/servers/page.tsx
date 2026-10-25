import Link from "next/link";
import { Plan, Prisma, ServerStatus } from "@prisma/client";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { liveStates, machineStats } from "../data";
import { formats } from "../format";
import ServerTable from "../ServerTable";
import { nodes } from "@/lib/nodes";

const ALL = 5000;

type Props = {
  searchParams: Promise<{
    q?: string;
    status?: string;
    plan?: string;
    node?: string;
    page?: string;
    limit?: string;
  }>;
};

export default async function AdminServers({ searchParams }: Props) {
  await requireAdmin();
  const params = await searchParams;
  const [search, status, plan, nodeParam] = [params.q, params.status, params.plan, params.node].map((v) =>
    String(v ?? "").trim()
  );
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  // All servers on one page by default, so sorting a column sorts every server, not just the newest ones.
  const pageSize = params.limit === undefined || params.limit === "all" ? ALL : Math.min(ALL, Math.max(50, parseInt(params.limit, 10) || ALL));

  const allNodes = nodes();
  const where: Prisma.ServerWhereInput = {
    ...(Object.hasOwn(ServerStatus, status) && { status: status as ServerStatus }),
    ...(Object.hasOwn(Plan, plan) && { plan: plan as Plan }),
    ...(nodeParam && { node: nodeParam }),
    ...(search && {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { subdomain: { contains: search.toLowerCase().split(".")[0] } },
        { owner: { email: { contains: search, mode: "insensitive" } } },
        { id: search },
        { node: { contains: search, mode: "insensitive" } },
      ],
    }),
  };

  const [all, { locale }, stats, totalCount, rows] = await Promise.all([
    getMessages(),
    getPreferences(),
    machineStats(),
    db.server.count({ where }),
    db.server.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { owner: { select: { id: true, email: true } } },
    }),
  ]);

  const t = all.admin;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  function pageLink(p: number) {
    const qp = new URLSearchParams();
    if (search) qp.set("q", search);
    if (status) qp.set("status", status);
    if (plan) qp.set("plan", plan);
    if (nodeParam) qp.set("node", nodeParam);
    if (pageSize !== ALL) qp.set("limit", String(pageSize));
    if (p > 1) qp.set("page", String(p));
    const qs = qp.toString();
    return `/admin/servers${qs ? `?${qs}` : ""}`;
  }

  return (
    <>
      <form className="admin-filters" role="search">
        <input name="q" defaultValue={search} placeholder={t.searchServers} aria-label={t.search} />
        <select name="status" defaultValue={status} aria-label={t.status}>
          <option value="">
            {t.status}: {t.any}
          </option>
          {Object.values(ServerStatus).map((s) => (
            <option key={s} value={s}>
              {t.statuses[s]}
            </option>
          ))}
        </select>
        <select name="plan" defaultValue={plan} aria-label={t.plan}>
          <option value="">
            {t.plan}: {t.any}
          </option>
          {Object.values(Plan).map((p) => (
            <option key={p} value={p}>
              {all.plans[p]}
            </option>
          ))}
        </select>
        {allNodes.length > 1 && (
          <select name="node" defaultValue={nodeParam} aria-label={t.machine}>
            <option value="">
              {t.machine}: {t.any}
            </option>
            {allNodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.id} {n.host && n.host !== "localhost" ? `(${n.host})` : ""}
              </option>
            ))}
          </select>
        )}
        <select name="limit" defaultValue={pageSize === ALL ? "all" : String(pageSize)} aria-label="Limit">
          <option value="all">{t.perPageAll}</option>
          <option value="100">{format(t.perPage, { n: 100 })}</option>
          <option value="200">{format(t.perPage, { n: 200 })}</option>
          <option value="500">{format(t.perPage, { n: 500 })}</option>
        </select>
        <button type="submit" className="secondary">
          {t.filter}
        </button>
      </form>
      {!stats && <p className="notice warn">{t.agentDown}</p>}
      <ServerTable rows={rows} live={liveStates(rows, stats)} all={all} f={formats(locale)} />
      {totalPages > 1 && (
        <nav className="admin-pagination card flush" aria-label="Pagination">
          <span className="muted small">
            {format(t.pageInfo, { page, total: totalPages, count: totalCount })}
          </span>
          <div className="admin-pagination-buttons">
            {page > 1 ? (
              <Link href={pageLink(page - 1)} className="button secondary small">
                ← {t.pagePrev}
              </Link>
            ) : (
              <span className="button secondary small disabled" aria-disabled="true">
                ← {t.pagePrev}
              </span>
            )}
            <span className="small muted mono" style={{ margin: "0 6px" }}>
              {page} / {totalPages}
            </span>
            {page < totalPages ? (
              <Link href={pageLink(page + 1)} className="button secondary small">
                {t.pageNext} →
              </Link>
            ) : (
              <span className="button secondary small disabled" aria-disabled="true">
                {t.pageNext} →
              </span>
            )}
          </div>
        </nav>
      )}
      {totalPages <= 1 && totalCount > 0 && (
        <p className="muted small">{format(t.totalServersCount, { count: totalCount })}</p>
      )}
    </>
  );
}
