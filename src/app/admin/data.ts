import "server-only";
import type { Server } from "@prisma/client";
import { getStats, type HostStats } from "@/lib/agent";
import { liveStateFrom, type LiveState } from "@/lib/servers";

/** What the game machine reports, or null when it can't be reached (the pages still show our records). */
export async function machineStats(): Promise<HostStats | null> {
  return getStats().catch((err) => {
    console.error("admin: stats failed", err);
    return null;
  });
}

export type Live = { state: LiveState; memoryUsedMb?: number; diskMb?: number; players?: number; maxPlayers?: number };

/** Each server's state for the tables, from one stats call instead of one call per server. */
export function liveStates(servers: Pick<Server, "id" | "status">[], stats: HostStats | null) {
  const byId = new Map(stats?.servers.map((s) => [s.id, s]));
  const live: Record<string, Live> = {};
  for (const server of servers) {
    const s = byId.get(server.id);
    live[server.id] = {
      state: liveStateFrom(server, stats ? (s ?? "missing") : "unknown"),
      memoryUsedMb: s?.memoryUsedMb,
      diskMb: s?.diskMb,
      players: s?.players,
      maxPlayers: s?.maxPlayers,
    };
  }
  return live;
}
