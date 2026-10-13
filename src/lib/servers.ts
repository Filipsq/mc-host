import "server-only";
import { Prisma, type Server } from "@prisma/client";
import { db } from "./db";
import { AgentError, deleteServer, getServerState, recreateServer, type AgentState, type CreateServerSpec } from "./agent";
import { getServerFor } from "./access";
import { planById } from "./plans";
import { addonType, canRunNonPremium } from "./plugins";

export type LiveState =
  | "starting"
  | "online"
  | "offline"
  | "sleeping"
  | "crashed"
  | "diskFull"
  | "restarting"
  | "suspended"
  | "awaitingPayment"
  | "unknown";

/** Combines our records with what the agent reports into one state for the UI. */
export async function getLiveState(server: Pick<Server, "id" | "status">): Promise<LiveState> {
  return (await getLiveDetails(server)).live;
}

/** The same, with what the agent said (when it was asked and answered). */
export async function getLiveDetails(server: Pick<Server, "id" | "status">): Promise<{ live: LiveState; agent?: AgentState }> {
  // Not on the game host while unpaid: no need to ask.
  if (server.status === "AWAITING_PAYMENT" || server.status === "SUSPENDED") return { live: liveStateFrom(server, "unknown") };
  try {
    const agent = await getServerState(server.id);
    return { live: liveStateFrom(server, agent), agent };
  } catch (err) {
    if (err instanceof AgentError) return { live: liveStateFrom(server, err.status === 404 ? "missing" : "unknown") };
    throw err;
  }
}

type KnownState = Pick<AgentState, "state" | "health" | "stopReason">;

/**
 * The same from an agent answer already in hand: "missing" when the game host
 * has no container for the server, "unknown" when it couldn't be asked.
 */
export function liveStateFrom(server: Pick<Server, "status">, s: KnownState | "missing" | "unknown"): LiveState {
  if (server.status === "AWAITING_PAYMENT") return "awaitingPayment";
  if (server.status === "SUSPENDED") return "suspended";
  // Paid but not yet created on the game host (the billing job retries).
  if (s === "missing") return server.status === "PROVISIONING" ? "starting" : "unknown";
  if (s === "unknown") return "unknown";
  if (s.state === "restarting") return "restarting";
  if (s.state === "running") return s.health === "healthy" ? "online" : "starting";
  if (s.stopReason === "disk") return "diskFull";
  if (server.status === "STOPPED") return "offline";
  if (s.stopReason === "sleeping") return "sleeping";
  if (s.stopReason === "crashed") return "crashed";
  return "offline";
}

/**
 * Returns the server only if it belongs to the user, so IDs in URLs can't reach
 * others' servers. Admins get every server, to help their owners; friends the
 * owner let in get it through getServerFor in ./access.
 */
export const getOwnedServer = (id: string, userId: string) => getServerFor(id, userId, "owner");

/** Removes the server from the game host (world and backups too) and from our records. */
export async function destroyServer(server: Pick<Server, "id">) {
  await deleteServer(server.id).catch((err) => {
    // Never created on the game host (e.g. unpaid): nothing to remove there.
    if (!(err instanceof AgentError && err.status === 404)) throw err;
  });
  await db.server.delete({ where: { id: server.id } });
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

/** The address as players type it. */
export function addressLabel(server: Pick<Server, "edition" | "subdomain" | "port">) {
  const { host, port } = joinAddress(server);
  return server.edition === "JAVA" ? host : `${host}:${port}`;
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
    backupsKept: plan.backupsKept,
    diskMb: plan.diskGb * 1024,
    gameMode: server.gameMode,
    difficulty: server.difficulty,
    motd: server.motd,
    pvp: server.pvp,
    whitelist: server.whitelist,
    whitelistPlayers: server.whitelistPlayers,
    onlineMode: server.onlineMode || !canRunNonPremium(server),
    level: server.level ?? "",
    seed: server.levelSeed ?? "",
    levelType: server.levelType ?? "",
    kind: server.edition === "JAVA" ? server.kind : "vanilla",
    modpack: server.modpack ?? undefined,
    modpackSource: server.kind === "modpack" ? (server.modpackSource ?? undefined) : undefined,
    modpackVersion: server.modpackVersionId ?? undefined,
    plugins: addonType(server) ? server.plugins : [],
  };
}

/** Whether the server is on the game host: paid for (or free) and not suspended. */
export const onHost = (s: Pick<Server, "status">) => ["RUNNING", "STOPPED", "SLEEPING"].includes(s.status);

/**
 * Rebuilds the server's container with what the panel has for it now: a running
 * server restarts with it, a stopped or sleeping one gets it on its next start.
 * Unpaid servers aren't on the game host; they get it when they're created.
 */
export async function applyToHost(server: Server) {
  if (!onHost(server)) return;
  await recreateServer(agentSpec(server), { keepStopped: true });
  // The rebuild brought the plugin list up to date too.
  if (server.pluginsPending) await db.server.update({ where: { id: server.id }, data: { pluginsPending: false } });
}

// Also the mail names OVH's default DNS zone defines: they have records of
// their own, so the wildcard that sends players to the router doesn't cover them.
const RESERVED = new Set(
  "www api app panel admin mail status help support play ftp imap pop3 smtp webmail autoconfig autodiscover".split(" "),
);

export function isValidSubdomain(s: string) {
  return /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/.test(s) && !s.includes("--") && !RESERVED.has(s);
}
