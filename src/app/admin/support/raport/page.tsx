import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { formats } from "../../format";

// The support bot's day (Fiq asked 2026-11-18): how many questions it got, split
// into easy (it solved them), medium (it answered, but the customer still asked
// for a person) and hard (it passed them on, didn't answer, or an admin was
// first), with each question, the answer and whether it was solved.

type Props = { searchParams: Promise<{ dzien?: string }> };
type Level = "easy" | "medium" | "hard";

const ZONE = "Europe/Warsaw";
const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, dateStyle: "short" }).format(d);

/** Midnight in Warsaw for a YYYY-MM-DD day, as a UTC instant. */
function warsawMidnight(day: string) {
  const guess = new Date(`${day}T00:00:00Z`);
  const offset = (d: Date) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, timeZoneName: "shortOffset" }).formatToParts(d);
    const m = /GMT([+-]\d+)?/.exec(parts.find((p) => p.type === "timeZoneName")?.value ?? "");
    return Number(m?.[1] ?? 0);
  };
  return new Date(guess.getTime() - offset(guess) * 3600_000);
}

const shiftDay = (day: string, by: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
};

function level(c: { result: string | null; personAfter: boolean }): Level {
  if (c.result === "answered") return c.personAfter ? "medium" : "easy";
  return "hard";
}

export default async function BotReport({ searchParams }: Props) {
  await requireAdmin();
  const { dzien } = await searchParams;
  const today = dayKey(new Date());
  const day = dzien && /^\d{4}-\d{2}-\d{2}$/.test(dzien) && dzien <= today ? dzien : today;
  const from = warsawMidnight(day);
  const to = warsawMidnight(shiftDay(day, 1));
  const [all, { locale }, cases] = await Promise.all([
    getMessages(),
    getPreferences(),
    db.supportBotCase.findMany({
      where: { askedAt: { gte: from, lt: to } },
      orderBy: { askedAt: "asc" },
      include: { user: { select: { email: true } } },
    }),
  ]);
  const t = all.support.admin.report;
  const f = formats(locale);
  const groups: Record<Level, typeof cases> = { easy: [], medium: [], hard: [] };
  for (const c of cases) groups[level(c)].push(c);
  const answered = cases.filter((c) => c.answeredAt && c.result === "answered");
  const avgSeconds = answered.length
    ? answered.reduce((s, c) => s + (c.answeredAt!.getTime() - c.askedAt.getTime()), 0) / answered.length / 1000
    : null;
  const solvedShare = cases.length ? Math.round((groups.easy.length / cases.length) * 100) : 0;

  return (
    <>
      <Link className="back" href="/admin/support">← {all.support.admin.title}</Link>
      <header className="page-head">
        <div className="stack-tight">
          <h2>{t.title}</h2>
          <p className="muted">{f.date(new Date(`${day}T12:00:00Z`))}</p>
        </div>
        <div className="row">
          <Link className="button secondary small" href={`/admin/support/raport?dzien=${shiftDay(day, -1)}`}>← {t.prev}</Link>
          {day < today && (
            <Link className="button secondary small" href={`/admin/support/raport?dzien=${shiftDay(day, 1)}`}>{t.next} →</Link>
          )}
        </div>
      </header>

      <div className="admin-grid">
        <div className="card stat">
          <p className="stat-label">{t.total}</p>
          <span className="stat-value">{cases.length}</span>
          <p className="muted small">{cases.length ? format(t.solvedShare, { n: solvedShare }) : t.none}</p>
        </div>
        {(["easy", "medium", "hard"] as const).map((l) => (
          <div key={l} className="card stat">
            <p className="stat-label">{t.levels[l].title}</p>
            <span className={`stat-value${l === "easy" ? " good" : l === "hard" ? " over" : ""}`}>{groups[l].length}</span>
            <p className="muted small">{t.levels[l].hint}</p>
          </div>
        ))}
        <div className="card stat">
          <p className="stat-label">{t.avgTime}</p>
          <span className="stat-value">{avgSeconds === null ? "–" : format(t.seconds, { n: f.number(avgSeconds) })}</span>
          <p className="muted small">{t.avgTimeHint}</p>
        </div>
      </div>

      {cases.length === 0 ? (
        <p className="muted">{t.empty}</p>
      ) : (
        (["hard", "medium", "easy"] as const)
          .filter((l) => groups[l].length > 0)
          .map((l) => (
            <section key={l} className="stack-tight">
              <h3>
                {t.levels[l].title} ({groups[l].length})
              </h3>
              <ul className="card flush bot-cases">
                {groups[l].map((c) => (
                  <li key={c.id}>
                    <div className="row">
                      <Link href={`/admin/support/${c.userId}`} className="break">
                        <strong>{c.user.email}</strong>
                      </Link>
                      <span className="row-inline">
                        <span className={`badge ${l === "easy" ? "online" : l === "medium" ? "starting" : "crashed"}`}>
                          {t.results[(c.result ?? "waiting") as keyof typeof t.results] ?? c.result}
                          {c.personAfter ? ` · ${t.personAfter}` : ""}
                        </span>
                        <span className="muted small nowrap">{f.time(c.askedAt)}</span>
                      </span>
                    </div>
                    <p className="bot-case-q"><span className="muted small">{t.question}:</span> {c.question || "–"}</p>
                    {c.answer && (
                      <p className="bot-case-a">
                        <span className="muted small">{t.answer}{c.answeredAt ? ` (${format(t.seconds, { n: f.number((c.answeredAt.getTime() - c.askedAt.getTime()) / 1000) })})` : ""}:</span> {c.answer}
                      </p>
                    )}
                    <p className="small">{l === "easy" ? `✅ ${t.solved}` : `❌ ${t.notSolved}`}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))
      )}
    </>
  );
}
