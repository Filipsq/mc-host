import "server-only";
import type { Server } from "@prisma/client";
import { getStats, type HostStats } from "@/lib/agent";
import { liveStateFrom, type LiveState } from "@/lib/servers";

// Asking every machine takes a while, so admin pages share one answer for a few seconds:
// going from the overview to the server list (or reloading) doesn't ask again.
const FRESH_MS = 15_000;
let last: { at: number; stats: Promise<HostStats | null> } | null = null;

/** What the game machines report, or null when they can't be reached (the pages still show our records). */
export function machineStats(): Promise<HostStats | null> {
  if (last && Date.now() - last.at < FRESH_MS) return last.stats;
  const stats = getStats().catch((err) => {
    console.error("admin: stats failed", err);
    return null;
  });
  last = { at: Date.now(), stats };
  // A failed answer isn't kept, so the next page tries the machines again.
  stats.then((s) => {
    if (s === null && last?.stats === stats) last = null;
  });
  return stats;
}

export type Live = { state: LiveState; memoryUsedMb?: number; diskMb?: number; players?: number; maxPlayers?: number; startedAt?: Date };

/** Each server's state for the tables, from one stats call instead of one call per server. */
export function liveStates(servers: Pick<Server, "id" | "status" | "node">[], stats: HostStats | null) {
  const byId = new Map(stats?.servers.map((s) => [s.id, s]));
  const live: Record<string, Live> = {};
  for (const server of servers) {
    const s = byId.get(server.id);
    const known = stats && !stats.unreachable.includes(server.node);
    live[server.id] = {
      state: liveStateFrom(server, known ? (s ?? "missing") : "unknown"),
      memoryUsedMb: s?.memoryUsedMb,
      diskMb: s?.diskMb,
      players: s?.players,
      maxPlayers: s?.maxPlayers,
      startedAt: s?.startedAt ? new Date(s.startedAt) : undefined,
    };
  }
  return live;
}
