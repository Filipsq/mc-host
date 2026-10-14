"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Messages } from "@/i18n/messages";
import { format } from "@/i18n/messages";
import type { MetricSample, MetricsRange, ServerMetrics } from "@/lib/agent";

// The agent samples every 30 s and keeps a day; the day view gets 5-minute averages.
const REFRESH_MS = 30_000;
const RANGES: Record<MetricsRange, { seconds: number; gap: number }> = {
  hour: { seconds: 3600, gap: 95 },
  day: { seconds: 86_400, gap: 660 },
};
// A reading older than this isn't "now" any more.
const FRESH_SECONDS = 95;

type Props = {
  id: string;
  java: boolean;
  running: boolean;
  memoryMb: number;
  locale: string;
  t: Messages["server"]["stats"];
};

type Loaded = ServerMetrics & { range: MetricsRange; at: number };

export default function Stats({ id, java, running, memoryMb, locale, t }: Props) {
  const [range, setRange] = useState<MetricsRange>("hour");
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stopped = false;
    async function load() {
      if (document.hidden) return;
      try {
        const res = await fetch(`/api/servers/${id}/metrics?range=${range}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as ServerMetrics;
        if (!stopped) {
          setData({ ...json, range, at: Math.floor(Date.now() / 1000) });
          setFailed(false);
        }
      } catch {
        if (!stopped) setFailed(true);
      }
    }
    load();
    const timer = setInterval(load, REFRESH_MS);
    const onShow = () => !document.hidden && load();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [id, range]);

  const fmt = useMemo(() => {
    const one = new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
    const whole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
    return {
      gb: (mb: number) => `${one.format(mb / 1024)} GB`,
      pct: (v: number) => `${whole.format(v)}%`,
      tps: (v: number) => one.format(v),
      n: (v: number) => whole.format(v),
    };
  }, [locale]);

  const samples = data?.samples ?? [];
  const last = samples.at(-1);
  const now = data?.at ?? 0;
  const current = running && last && now - last.t < FRESH_SECONDS ? last : undefined;
  const players = running && data ? data.players : [];
  const online = data?.online ?? players.length;
  const span = RANGES[data?.range ?? range];
  const from = now - span.seconds;
  const peak = (pick: (s: MetricSample) => number | undefined) => Math.max(0, ...samples.map((s) => pick(s) ?? 0));
  const noTps = java && samples.length >= 4 && samples.every((s) => s.tps === undefined);

  const charts: ChartSpec[] = [
    {
      key: "ram",
      title: t.ram,
      value: current ? fmt.gb(current.memMb) : t.none,
      sub: format(t.ofLimit, { limit: fmt.gb(memoryMb) }),
      pick: (s) => s.memMb,
      max: Math.max(memoryMb, peak((s) => s.memMb)),
      show: fmt.gb,
    },
    {
      key: "cpu",
      title: t.cpu,
      value: current?.cpu !== undefined ? fmt.pct(current.cpu) : t.none,
      sub: t.cpuHint,
      pick: (s) => s.cpu,
      max: 100,
      show: fmt.pct,
    },
    ...(java
      ? [
          {
            key: "tps",
            title: t.tps,
            value: current?.tps !== undefined ? fmt.tps(current.tps) : t.none,
            sub: noTps ? t.noTps : t.tpsHint,
            pick: (s: MetricSample) => s.tps,
            max: 20,
            show: fmt.tps,
            top: "20",
          },
        ]
      : []),
    {
      key: "players",
      title: t.playersChart,
      value: current ? fmt.n(current.players) : t.none,
      sub: data?.maxPlayers ? format(t.ofLimit, { limit: fmt.n(data.maxPlayers) }) : "",
      pick: (s) => s.players,
      max: Math.max(4, Math.ceil((peak((s) => s.players) + 1) / 2) * 2),
      show: fmt.n,
    },
  ];

  const timeFmt = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
  const time = (sec: number) => timeFmt.format(new Date(sec * 1000));
  const notice = failed && !data ? t.unavailable : !running ? t.off : samples.length < 2 ? t.collecting : null;

  return (
    <section className="stack">
      <div className="stats-head">
        <h2>{t.title}</h2>
        <div className="stats-range" role="group" aria-label={t.title}>
          {(["hour", "day"] as const).map((r) => (
            <button key={r} type="button" className="small" aria-pressed={range === r} onClick={() => setRange(r)}>
              {t[r]}
            </button>
          ))}
        </div>
      </div>
      <div className="card stack">
        <div className="stats-players">
          <p className="address-label">{t.players}</p>
          <p className="stats-players-count">
            <strong>{running && data ? (data.maxPlayers ? format(t.playersCount, { n: online, max: data.maxPlayers }) : online) : t.none}</strong>
          </p>
          {players.length > 0 ? (
            <ul className="stats-player-list">
              {players.map((p) => (
                <li key={p} className="chip">
                  <span className="dot online" aria-hidden />
                  {p}
                </li>
              ))}
            </ul>
          ) : (
            running && data && online === 0 && <p className="muted small">{t.nobody}</p>
          )}
        </div>
        {notice && <p className="notice">{notice}</p>}
        <div className={`stats-grid${data && data.range !== range ? " loading" : ""}`}>
          {charts.map((c) => (
            <div key={c.key} className="stats-tile">
              <div className="stats-tile-head">
                <span className="address-label">{c.title}</span>
                <span className="stats-value">{c.value}</span>
              </div>
              <p className="muted small stats-sub">{c.sub}</p>
              <Chart
                points={samples.map((s) => ({ t: s.t, v: c.pick(s) }))}
                from={from}
                to={now}
                gap={span.gap}
                max={c.max}
                show={c.show}
                top={c.top ?? c.show(c.max)}
                time={time}
                label={`${c.title}: ${c.value}`}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

type ChartSpec = {
  key: string;
  title: string;
  value: string;
  sub: string;
  pick: (s: MetricSample) => number | undefined;
  max: number;
  show: (v: number) => string;
  top?: string; // the axis label at the top, when it reads better than show(max)
};

type Point = { t: number; v: number | undefined };

const HEIGHT = 110;
const TOP = 8; // room for the line at the very top

/** One metric over time: a 2px line over a faint area, with a crosshair and tooltip on hover. */
function Chart({
  points,
  from,
  to,
  gap,
  max,
  show,
  top,
  time,
  label,
}: {
  points: Point[];
  from: number;
  to: number;
  gap: number;
  max: number;
  show: (v: number) => string;
  top: string;
  time: (sec: number) => string;
  label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const span = Math.max(1, to - from);
  const round = (n: number) => Math.round(n * 10) / 10;
  const x = (t: number) => round(((t - from) / span) * width);
  const y = (v: number) => round(TOP + (1 - Math.min(v, max) / max) * (HEIGHT - TOP - 1));

  // A gap in the readings (the server was off) breaks the line instead of bridging it.
  const runs: { t: number; v: number }[][] = [];
  let run: { t: number; v: number }[] = [];
  for (const p of points) {
    if (p.t < from) continue;
    if (p.v === undefined || (run.length > 0 && p.t - run[run.length - 1].t > gap)) {
      if (run.length) runs.push(run);
      run = [];
    }
    if (p.v !== undefined) run.push({ t: p.t, v: p.v });
  }
  if (run.length) runs.push(run);

  const shown = hover !== null ? points[hover] : undefined;

  function pointAt(clientX: number) {
    const el = box.current;
    if (!el || points.length === 0) return;
    const rect = el.getBoundingClientRect();
    const t = from + ((clientX - rect.left) / rect.width) * span;
    let best: number | null = null;
    points.forEach((p, i) => {
      if (p.v === undefined || p.t < from) return;
      if (best === null || Math.abs(p.t - t) < Math.abs(points[best].t - t)) best = i;
    });
    setHover(best !== null && Math.abs(points[best].t - t) <= gap ? best : null);
  }

  return (
    <div className="chart">
      <div
        ref={box}
        className="chart-plot"
        onPointerMove={(e) => pointAt(e.clientX)}
        onPointerDown={(e) => pointAt(e.clientX)}
        onPointerLeave={() => setHover(null)}
      >
        <span className="chart-max">{top}</span>
        {width > 0 && (
          <svg width={width} height={HEIGHT} role="img" aria-label={label}>
            {[0, 0.5, 1].map((f) => (
              <line key={f} className="chart-grid" x1={0} x2={width} y1={y(max * f)} y2={y(max * f)} />
            ))}
            {runs.map((r, i) =>
              r.length === 1 ? (
                <circle key={i} className="chart-point" cx={x(r[0].t)} cy={y(r[0].v)} r={3} />
              ) : (
                <g key={i}>
                  <path
                    className="chart-area"
                    d={`M${x(r[0].t)},${HEIGHT} ${r.map((p) => `L${x(p.t)},${y(p.v)}`).join(" ")} L${x(r[r.length - 1].t)},${HEIGHT}Z`}
                  />
                  <path className="chart-line" d={r.map((p, j) => `${j ? "L" : "M"}${x(p.t)},${y(p.v)}`).join(" ")} />
                </g>
              ),
            )}
            {shown?.v !== undefined && (
              <>
                <line className="chart-cross" x1={x(shown.t)} x2={x(shown.t)} y1={0} y2={HEIGHT} />
                <circle className="chart-dot" cx={x(shown.t)} cy={y(shown.v)} r={4.5} />
              </>
            )}
          </svg>
        )}
        {shown?.v !== undefined && (
          <div className={`chart-tip${x(shown.t) > width * 0.6 ? " left" : ""}`} style={{ left: x(shown.t) }}>
            <strong>{show(shown.v)}</strong> <span className="muted">{time(shown.t)}</span>
          </div>
        )}
      </div>
      <div className="chart-axis muted" aria-hidden>
        <span>{to > 0 ? time(from) : ""}</span>
        <span>{to > 0 ? time(from + span / 2) : ""}</span>
        <span>{to > 0 ? time(to) : ""}</span>
      </div>
    </div>
  );
}
