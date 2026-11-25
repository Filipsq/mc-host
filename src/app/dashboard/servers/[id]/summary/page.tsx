import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getMessages, getPreferences } from "@/i18n/server";
import { getServerFor } from "@/lib/access";
import { getMonthSummary } from "@/lib/agent";
import { isMonth, monthName, monthOf, previousMonth } from "@/lib/monthSummary";
import ShareSummary from "./ShareSummary";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ month?: string }> };

// "Podsumowanie miesiąca": the month's players as a picture to save and share
// (src/app/api/servers/[id]/summary-image), counted by the agent (agent/monthstats.go).
export default async function SummaryPage({ params, searchParams }: Props) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const [{ id }, { month: asked }] = await Promise.all([params, searchParams]);
  const server = await getServerFor(id, session.user.id, "view");
  if (!server) notFound();
  const [all, { locale }] = await Promise.all([getMessages(), getPreferences()]);
  const t = all.summary;
  const thisMonth = monthOf(new Date());
  const lastMonth = previousMonth(thisMonth);
  const month = isMonth(asked) && (asked === thisMonth || asked === lastMonth) ? asked : thisMonth;
  const summary = await getMonthSummary(server.id, month).catch(() => null);
  const base = `/dashboard/servers/${server.id}/summary`;
  const image = `/api/servers/${server.id}/summary-image?month=${month}`;

  return (
    <div className="stack">
      <h2>{t.title}</h2>
      <p className="muted">{t.intro}</p>
      <div className="row-inline summary-months" role="tablist">
        {[thisMonth, lastMonth].map((m) => (
          <Link
            key={m}
            role="tab"
            aria-selected={m === month}
            className={m === month ? "button small" : "button secondary small"}
            href={m === thisMonth ? base : `${base}?month=${m}`}
          >
            <span style={{ textTransform: "capitalize" }}>{monthName(m, locale)}</span>
          </Link>
        ))}
      </div>
      {!summary ? (
        <p className="notice warn">{t.unreachable}</p>
      ) : summary.playerMinutes === 0 ? (
        <p className="notice">{t.empty}</p>
      ) : (
        <div className="summary-wrap">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="summary-image" src={image} width={1080} height={1920} alt={`${t.title}: ${monthName(month, locale)}`} />
          <div className="stack summary-actions">
            <ShareSummary image={image} file={`podsumowanie-${month}.png`} title={`${server.name} · ${monthName(month, locale)}`} t={t} />
            <p className="muted small">{t.howTo}</p>
            <p className="muted small">{t.counted}</p>
          </div>
        </div>
      )}
    </div>
  );
}
