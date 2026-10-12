import "server-only";
import { Prisma, type Server } from "@prisma/client";
import { db } from "./db";
import { AgentError, getServerState, type CreateServerSpec } from "./agent";
import { planById } from "./plans";

export type LiveState =
  | "starting"
  | "online"
  | "offline"
  | "sleeping"
  | "crashed"
  | "restarting"
  | "suspended"
  | "awaitingPayment"
  | "unknown";

/** Combines our records with what the agent reports into one state for the UI. */
export async function getLiveState(server: Pick<Server, "id" | "status">): Promise<LiveState> {
  if (server.status === "AWAITING_PAYMENT") return "awaitingPayment";
  if (server.status === "SUSPENDED") return "suspended";
  try {
    const s = await getServerState(server.id);
    if (s.state === "restarting") return "restarting";
    if (s.state === "running") return s.health === "healthy" ? "online" : "starting";
    if (server.status === "STOPPED") return "offline";
    if (s.stopReason === "sleeping") return "sleeping";
    if (s.stopReason === "crashed") return "crashed";
    return "offline";
  } catch (err) {
    if (err instanceof AgentError) {
      // Paid but not yet created on the game host (the billing job retries).
      if (err.status === 404 && server.status === "PROVISIONING") return "starting";
      return "unknown";
    }
    throw err;
  }
}

/** Returns the server only if it belongs to the user, so IDs in URLs can't reach others' servers. */
export function getOwnedServer(id: string, userId: string) {
  return db.server.findFirst({ where: { id, ownerId: userId } });
}

// Java servers' own ports sit behind the router (which owns 25565), so the
// pool must not include 25565. Bedrock players connect to these ports directly.
const PORT_START = Number(process.env.PORT_RANGE_START ?? 30000);
const PORT_END = Number(process.env.PORT_RANGE_END ?? 30999);

/**
 * Creates the server row with the lowest free port. The unique index on port
 * settles races between two simultaneous creations; the loser retries.
 * Returns "subdomainTaken" if the address is already in use, or null if no port is free.
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
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
      const fields = (err.meta?.target as string[] | undefined) ?? [];
      if (fields.includes("subdomain")) return "subdomainTaken" as const;
    }
  }
  return null;
}

const GAME_DOMAIN = process.env.GAME_DOMAIN ?? "localhost";
const GAME_HOST = process.env.GAME_HOST ?? "localhost";

/** What players type in Minecraft to join. */
export function joinAddress(server: Pick<Server, "edition" | "subdomain" | "port">) {
  if (server.edition === "JAVA") return { host: `${server.subdomain}.${GAME_DOMAIN}`, port: null };
  return { host: GAME_HOST, port: server.port };
}

/** The container spec the agent needs, derived from the server's plan. */
export function agentSpec(server: Server): CreateServerSpec {
  const plan = planById(server.plan);
  return {
    id: server.id,
    name: server.name,
    edition: server.edition,
    memoryMb: plan.ramGb * 1024,
    cpus: plan.cpus,
    port: server.port!,
    maxPlayers: plan.maxPlayers ?? 0,
    version: server.version,
    hostname: server.edition === "JAVA" ? joinAddress(server).host : "",
    autostop: !plan.alwaysOn,
  };
}

// Also the mail names OVH's default DNS zone defines: they have records of
// their own, so the wildcard that sends players to the router doesn't cover them.
const RESERVED = new Set(
  "www api app panel admin mail status help support play ftp imap pop3 smtp webmail autoconfig autodiscover".split(" "),
);

export function isValidSubdomain(s: string) {
  return /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/.test(s) && !s.includes("--") && !RESERVED.has(s);
}
