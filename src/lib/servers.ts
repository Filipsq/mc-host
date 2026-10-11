import "server-only";
import { Prisma, type Server } from "@prisma/client";
import { db } from "./db";
import { AgentError, getServerState } from "./agent";

export type LiveState = "starting" | "online" | "offline" | "crashed" | "restarting" | "unknown";

/** Combines what Docker reports with the health check into one state for the UI. */
export async function getLiveState(server: Pick<Server, "id" | "status">): Promise<LiveState> {
  try {
    const s = await getServerState(server.id);
    if (s.state === "restarting") return "restarting";
    if (s.state === "running") return s.health === "healthy" ? "online" : "starting";
    if (s.state === "exited" || s.state === "dead") {
      // A server the owner stopped is offline whatever its exit code; otherwise it died on its own.
      return server.status === "STOPPED" || s.exitCode === 0 ? "offline" : "crashed";
    }
    return "offline";
  } catch (err) {
    if (err instanceof AgentError) return "unknown";
    throw err;
  }
}

/** Returns the server only if it belongs to the user, so IDs in URLs can't reach others' servers. */
export function getOwnedServer(id: string, userId: string) {
  return db.server.findFirst({ where: { id, ownerId: userId } });
}

const PORT_START = Number(process.env.PORT_RANGE_START ?? 25565);
const PORT_END = Number(process.env.PORT_RANGE_END ?? 25664);

/**
 * Creates the server row with the lowest free port. The unique index on port
 * settles races between two simultaneous creations; the loser retries.
 */
export async function createServerRecord(data: Omit<Prisma.ServerUncheckedCreateInput, "port">) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const taken = await db.server.findMany({
      where: { port: { gte: PORT_START, lte: PORT_END } },
      select: { port: true },
    });
    const used = new Set(taken.map((s) => s.port));
    let port = PORT_START;
    while (used.has(port) && port <= PORT_END) port++;
    if (port > PORT_END) return null;
    try {
      return await db.server.create({ data: { ...data, port } });
    } catch (err) {
      const portClash =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (!portClash) throw err;
    }
  }
  return null;
}

export function gameAddress(port: number | null) {
  const host = process.env.GAME_HOST ?? "localhost";
  return { host, port };
}
