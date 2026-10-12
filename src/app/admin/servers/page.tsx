import { Plan, Prisma, ServerStatus } from "@prisma/client";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { liveStates, machineStats } from "../data";
import { formats } from "../format";
import ServerTable from "../ServerTable";

const SHOWN = 200;

type Props = { searchParams: Promise<{ q?: string; status?: string; plan?: string }> };

export default async function AdminServers({ searchParams }: Props) {
  await requireAdmin();
  const params = await searchParams;
  const [search, status, plan] = [params.q, params.status, params.plan].map((v) => String(v ?? "").trim());
  const where: Prisma.ServerWhereInput = {
    ...(Object.hasOwn(ServerStatus, status) && { status: status as ServerStatus }),
    ...(Object.hasOwn(Plan, plan) && { plan: plan as Plan }),
    ...(search && {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { subdomain: { contains: search.toLowerCase().split(".")[0] } },
        { owner: { email: { contains: search, mode: "insensitive" } } },
        { id: search },
      ],
    }),
  };
  const [all, { locale }, stats, rows] = await Promise.all([
    getMessages(),
    getPreferences(),
    machineStats(),
    db.server.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: SHOWN + 1,
      include: { owner: { select: { id: true, email: true } } },
    }),
  ]);
  const t = all.admin;
  const shown = rows.slice(0, SHOWN);

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
        <button type="submit" className="secondary">
          {t.filter}
        </button>
      </form>
      {!stats && <p className="notice warn">{t.agentDown}</p>}
      <ServerTable rows={shown} live={liveStates(shown, stats)} all={all} f={formats(locale)} />
      {rows.length > SHOWN && <p className="muted small">{format(t.shown, { n: SHOWN })}</p>}
    </>
  );
}
