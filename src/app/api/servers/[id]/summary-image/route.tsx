import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { getSession } from "@/lib/session";
import { getServerFor } from "@/lib/access";
import { getMessages, getPreferences } from "@/i18n/server";
import { getMonthSummary } from "@/lib/agent";
import { joinAddress } from "@/lib/servers";
import { dayName, hours, isMonth, monthName, monthOf } from "@/lib/monthSummary";

export const runtime = "nodejs";

// The Minecraft-like pixel font of the site's headings, with Polish letters (latin-ext).
const fontDir = path.join(process.cwd(), "node_modules/@fontsource/jersey-10/files");
let fonts: Promise<Buffer[]> | null = null;
const loadFonts = () =>
  (fonts ??= Promise.all([
    readFile(path.join(fontDir, "jersey-10-latin-400-normal.woff")),
    readFile(path.join(fontDir, "jersey-10-latin-ext-400-normal.woff")),
  ]));
let icon: Promise<string> | null = null;
const loadIcon = () =>
  (icon ??= readFile(path.join(process.cwd(), "public/icons/icon-192.png")).then((b) => `data:image/png;base64,${b.toString("base64")}`));

const GREEN = "#5bc236";
const GOLD = "#f2c14e";
const MUTED = "#a3b1c4";

/**
 * "Podsumowanie miesiąca" as a 1080×1920 picture (a phone screen, for TikTok,
 * Instagram stories and Discord): GET ?month=2026-11, &download=1 to save it.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.id) return new Response("unauthorized", { status: 401 });
  const { id } = await params;
  const server = await getServerFor(id, session.user.id, "view");
  if (!server) return new Response("not found", { status: 404 });
  const url = new URL(req.url);
  const asked = url.searchParams.get("month") ?? undefined;
  const month = isMonth(asked) ? asked : monthOf(new Date());

  const [summary, all, { locale }, [latin, latinExt], logo] = await Promise.all([
    getMonthSummary(server.id, month).catch(() => null),
    getMessages(),
    getPreferences(),
    loadFonts(),
    loadIcon(),
  ]);
  if (!summary) return new Response("agent unreachable", { status: 503 });
  const t = all.summary;
  const current = month === monthOf(new Date());
  const address = joinAddress(server);
  const join = address.port ? `${address.host}:${address.port}` : address.host;
  const top = summary.top.slice(0, 3);
  const nf = new Intl.NumberFormat(locale);

  const tile = (label: string, value: string, color = "#e8eef5", size = 120) => (
    <div
      style={{
        display: "flex", flexDirection: "column", width: 452, height: 250, padding: "30px 40px", borderRadius: 28,
        background: "rgba(20,26,34,0.92)", border: "3px solid #33425a",
      }}
    >
      <div style={{ fontSize: 48, color: MUTED }}>{label}</div>
      <div style={{ display: "flex", flex: 1, alignItems: "center", fontSize: size, lineHeight: 1, color }}>{value}</div>
    </div>
  );

  const image = (
    <div
      style={{
        width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: "110px 70px 90px",
        fontFamily: "Jersey, JerseyExt", color: "#e8eef5", backgroundColor: "#0b0f14",
        backgroundImage:
          "radial-gradient(circle at 50% 30%, rgba(91,194,54,0.28), rgba(11,15,20,0) 60%), linear-gradient(rgba(91,194,54,0.10) 2px, transparent 2px), linear-gradient(90deg, rgba(91,194,54,0.10) 2px, transparent 2px)",
        backgroundSize: "100% 100%, 90px 90px, 90px 90px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} width={84} height={84} alt="" />
        <div style={{ fontSize: 64, color: GREEN, letterSpacing: 2 }}>{t.card.heading}</div>
      </div>
      <div style={{ fontSize: 150, lineHeight: 1, marginTop: 40, textTransform: "capitalize" }}>{monthName(month, locale)}</div>
      {current && <div style={{ fontSize: 52, color: MUTED, marginTop: 22 }}>{t.card.soFar}</div>}
      <div style={{ fontSize: 76, color: GOLD, marginTop: 24, lineHeight: 1.05 }}>{server.name}</div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 36, marginTop: 64 }}>
        {tile(t.card.players, nf.format(summary.players), GREEN)}
        {tile(t.card.hours, hours(summary.playerMinutes, locale))}
        {tile(t.card.peak, nf.format(summary.peak))}
        {tile(t.card.bestDay, summary.busiestDay ? dayName(summary.busiestDay, locale) : "–", "#e8eef5", 80)}
      </div>

      {top.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", marginTop: 64 }}>
          <div style={{ fontSize: 58, color: MUTED }}>{t.card.top}</div>
          {top.map((p, i) => (
            <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 28, marginTop: 22 }}>
              <div
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", width: 88, height: 88, borderRadius: 18,
                  fontSize: 64, background: i === 0 ? GOLD : i === 1 ? "#c9d3df" : "#c98a4b", color: "#1a1206",
                }}
              >
                {String(i + 1)}
              </div>
              <div style={{ fontSize: 78, flex: 1 }}>{p.name}</div>
              <div style={{ fontSize: 64, color: MUTED }}>{`${hours(p.minutes, locale)} h`}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", marginTop: "auto", paddingTop: 40 }}>
        <div style={{ fontSize: 44, color: MUTED }}>{t.card.join}</div>
        <div style={{ fontSize: 72, color: GREEN }}>{join}</div>
        <div style={{ fontSize: 44, color: MUTED, marginTop: 30 }}>mchosting.pl</div>
      </div>
    </div>
  );

  const res = new ImageResponse(image, {
    width: 1080,
    height: 1920,
    fonts: [
      { name: "Jersey", data: latin, weight: 400, style: "normal" },
      { name: "JerseyExt", data: latinExt, weight: 400, style: "normal" },
    ],
  });
  res.headers.set("Cache-Control", "private, max-age=300");
  if (url.searchParams.get("download")) {
    res.headers.set("Content-Disposition", `attachment; filename="podsumowanie-${month}.png"`);
  }
  return res;
}
