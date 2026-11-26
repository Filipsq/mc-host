import "server-only";
import Link from "next/link";
import type { Server } from "@prisma/client";
import { db } from "@/lib/db";
import { addressLabel, getLiveDetails, type LiveState } from "@/lib/servers";
import { diskLimitMb } from "@/lib/disk";
import { EDITION_NAMES } from "@/lib/editions";
import { isServerKind } from "@/lib/modpacks";
import { BAD_EVENTS, serverHistory, type HistoryEntry } from "@/lib/serverEvents";
import type { Messages } from "@/i18n/messages";
import type { Formats } from "./format";

// The customer's servers at the top of an admin's chat (Fiq asked 2026-11-26): each one
// a card that opens to its type, version, machine, plan and the latest of its history,
// so he can answer without opening the server's panel.

const AGENT_WAIT_MS = 2500;
const HISTORY_IN_CHAT = 8;
const DAY = 24 * 60 * 60 * 1000;

export const SERVER_CARD_FIELDS = {
  id: true,
  name: true,
  ownerId: true,
  edition: true,
  kind: true,
  version: true,
  plan: true,
  status: true,
  node: true,
  memoryMb: true,
  plugins: true,
  modpack: true,
  modpackTitle: true,
  modpackVersion: true,
  paidUntil: true,
  lastPlayedAt: true,
  createdAt: true,
  subdomain: true,
  port: true,
  customDomain: true,
  domainUntil: true,
  addons: true,
  adminTest: true,
} as const;

type CardServer = Pick<Server, keyof typeof SERVER_CARD_FIELDS>;

/** What the server runs, for an admin: "Java · Fabric", "Java · Mod pack: Cobblemon", "Bedrock". */
export function typeText(s: Pick<Server, "edition" | "kind" | "modpack" | "modpackTitle">, all: Messages) {
  const kind = s.edition === "JAVA" && isServerKind(s.kind) ? s.kind : null;
  const label = kind && kind !== "vanilla" ? (kind === "modpack" ? `${all.server.kinds.modpack}: ${s.modpackTitle ?? s.modpack ?? ""}` : all.server.kinds[kind]) : kind === "vanilla" ? "Paper" : null;
  return [EDITION_NAMES[s.edition], label].filter(Boolean).join(" · ");
}

const versionText = (s: Pick<Server, "version" | "modpackVersion">, all: Messages) =>
  `${s.version === "LATEST" ? all.settings.latest : s.version}${s.modpackVersion ? ` (${s.modpackVersion})` : ""}`;

/** The agent's answer, or nothing if it takes too long (a machine that's down mustn't hold up the chat). */
async function liveOf(s: CardServer) {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), AGENT_WAIT_MS));
  return Promise.race([getLiveDetails(s).catch(() => null), timeout]);
}

/** One line of a server's history: when, what, the detail and who, if not the owner. */
export function HistoryList({ list, all, f }: { list: HistoryEntry[]; all: Messages; f: Formats }) {
  const t = all.admin.history;
  if (list.length === 0) return <p className="muted small">{t.empty}</p>;
  return (
    <ol className="srv-history">
      {list.map((e) => {
        const actor = t.actors[e.actor];
        return (
          <li key={e.id} className={BAD_EVENTS.has(e.kind) ? "bad" : e.kind === "payment" || e.kind === "upgrade" || e.kind === "paymentGift" ? "money" : undefined}>
            <time dateTime={e.at.toISOString()}>{f.dateTime(e.at)}</time>
            <span className="srv-history-what">
              <strong>{t.kinds[e.kind] ?? e.kind}</strong>
              {e.detail && <span className="srv-history-detail"> {e.detail}</span>}
              {actor && <span className="srv-history-who"> · {e.actorEmail && e.actor === "friend" ? e.actorEmail : actor}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

async function ServerCard({ s, open, all, f }: { s: CardServer; open: boolean; all: Messages; f: Formats }) {
  const t = all.admin.history;
  const [live, history, crashes] = await Promise.all([
    liveOf(s),
    serverHistory(s.id, HISTORY_IN_CHAT),
    db.serverEvent.count({ where: { serverId: s.id, kind: "crash", createdAt: { gte: new Date(Date.now() - 7 * DAY) } } }),
  ]);
  const state: LiveState = live?.live ?? "unknown";
  const agent = live?.agent;
  const facts: [string, React.ReactNode][] = [
    [t.type, typeText(s, all)],
    [t.version, versionText(s, all)],
    [t.machine, <span key="m" className="mono">{s.node}</span>],
    [t.plan, `${all.plans[s.plan]} · ${f.gb(s.memoryMb)}${s.adminTest ? ` · ${all.admin.testServer}` : ""}`],
    [t.disk, agent?.diskMb !== undefined ? `${f.size(agent.diskMb)} / ${f.size(diskLimitMb(s))}` : "–"],
    [t.address, <span key="a" className="mono break">{addressLabel(s)}</span>],
    ...(s.plan !== "FREE" ? [[t.paidUntil, s.paidUntil ? f.dateTime(s.paidUntil) : "–"] as [string, React.ReactNode]] : []),
    [t.lastPlayed, f.ago(s.lastPlayedAt)],
    [t.plugins, String(s.plugins.length)],
    [t.crashes, <span key="c" className={crashes > 0 ? "srv-bad" : undefined}>{crashes}</span>],
    [t.created, f.date(s.createdAt)],
  ];
  return (
    <details className="srv-card" open={open}>
      <summary>
        <span className="srv-card-head">
          <span className="srv-card-name">{s.name}</span>
          <span className={`badge ${state}`}>{all.server.live[state]}</span>
        </span>
        <span className="srv-card-sub muted small">
          {typeText(s, all)} · {versionText(s, all)} · {all.plans[s.plan]} · {s.node}
        </span>
      </summary>
      <div className="srv-card-body">
        <dl className="srv-facts">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <div className="srv-card-links">
          <Link className="button small" href={`/dashboard/servers/${s.id}`}>{t.openPanel}</Link>
          <Link className="button secondary small" href={`/admin/servers/${s.id}`}>{t.details}</Link>
        </div>
        <h4 className="srv-history-title">{t.title}</h4>
        <HistoryList list={history} all={all} f={f} />
        {history.length >= HISTORY_IN_CHAT && (
          <Link className="small" href={`/admin/servers/${s.id}#historia`}>{t.more} →</Link>
        )}
      </div>
    </details>
  );
}

/** The customer's servers as cards; all closed until clicked (Fiq asked 2026-11-26). */
export default async function ServerInfoCards({ servers, all, f }: { servers: CardServer[]; all: Messages; f: Formats }) {
  if (servers.length === 0) return <p className="muted small">{all.admin.nav.servers}: {all.support.admin.noServers}</p>;
  return (
    <div className="srv-cards">
      {servers.map((s) => (
        <ServerCard key={s.id} s={s} open={false} all={all} f={f} />
      ))}
    </div>
  );
}
