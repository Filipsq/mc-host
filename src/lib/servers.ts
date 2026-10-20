import "server-only";
import { Prisma, type Server } from "@prisma/client";
import { db } from "./db";
import {
  AgentError,
  copyServer,
  deleteServer,
  forgetServerNode,
  getServerState,
  listWorlds,
  recreateServer,
  setPeerRoutes,
  type AgentState,
  type CreateServerSpec,
  type World,
} from "./agent";
import { getServerFor } from "./access";
import { oversold, pickNode } from "./capacity";
import { planById } from "./plans";
import { TMOD_ARCH } from "./terraria";
import { MAIN_NODE, nodeById, nodes, routerAddress } from "./nodes";
import { addonType, canCrossplay, canRunNonPremium } from "./plugins";
import { isPreYearVersion, maxPlayersFor } from "./settings";
import { isModLoader } from "./modpacks";

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
// pool must not include 25565. Bedrock (UDP) and Terraria (TCP) players connect
// to these ports directly.
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
      // Mods' jetpacks and wings need flying, or the server kicks their players.
      const allowFlight = data.allowFlight ?? (data.kind === "modpack" || isModLoader(data.kind));
      return await db.server.create({ data: { ...data, allowFlight, port } });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
      const fields = (err.meta?.target as string[] | undefined) ?? [];
      if (fields.includes("subdomain")) return "subdomainTaken" as const;
    }
  }
  return null;
}

const GAME_DOMAIN = process.env.GAME_DOMAIN ?? "localhost";

/** The Java address: every machine's servers are reached through the main machine's router. */
function javaHost(server: Pick<Server, "subdomain">) {
  return `${server.subdomain}.${GAME_DOMAIN}`;
}

/** What players type in the game to join: a Java address, or a host and port (Bedrock, Terraria). */
export function joinAddress(server: Pick<Server, "edition" | "subdomain" | "port" | "node">) {
  if (server.edition === "JAVA") return { host: javaHost(server), port: null };
  return { host: nodeById(server.node).host, port: server.port };
}

/**
 * Where Bedrock players join a crossplay server, straight to its machine on the
 * server's own port: on the main machine the Java address works too (the
 * wildcard DNS name points there), on the others it's that machine's host.
 */
export function bedrockHost(server: Pick<Server, "subdomain" | "node">) {
  return server.node === MAIN_NODE ? javaHost(server) : nodeById(server.node).host;
}

export function crossplayAddress(server: Pick<Server, "edition" | "kind" | "crossplay" | "subdomain" | "port" | "node">) {
  if (!server.crossplay || !canCrossplay(server)) return null;
  return { host: bedrockHost(server), port: server.port };
}

/** Tells the main machine's router where the Java servers on the other machines are (see agent/peers.go). */
export async function syncPeerRoutes() {
  const others = nodes().filter((n) => n.id !== MAIN_NODE);
  if (others.length === 0) return;
  const servers = await db.server.findMany({
    where: { edition: "JAVA", node: { in: others.map((n) => n.id) } },
    select: { subdomain: true, node: true },
  });
  await setPeerRoutes(Object.fromEntries(servers.map((s) => [javaHost(s), routerAddress(nodeById(s.node))])));
}

/** The address as players type it. */
export function addressLabel(server: Pick<Server, "edition" | "subdomain" | "port" | "node">) {
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
    maxPlayers: maxPlayersFor(server, plan),
    version: server.version,
    hostname: server.edition === "JAVA" ? javaHost(server) : "",
    password: server.edition === "TERRARIA" ? (server.serverPassword ?? "") : undefined,
    autostop: !plan.alwaysOn,
    backupsKept: plan.backupsKept,
    diskMb: plan.diskGb * 1024,
    gameMode: server.gameMode,
    difficulty: server.difficulty,
    motd: server.motd,
    pvp: server.pvp,
    whitelist: server.whitelist && server.edition !== "TERRARIA",
    whitelistPlayers: server.whitelistPlayers,
    onlineMode: server.onlineMode || !canRunNonPremium(server),
    crossplay: server.crossplay && canCrossplay(server),
    allowFlight: server.allowFlight,
    hardcore: server.hardcore,
    commandBlocks: server.commandBlocks,
    spawnProtection: server.spawnProtection,
    level: server.level ?? "",
    seed: server.levelSeed ?? "",
    levelType: server.levelType ?? "",
    kind: server.edition === "BEDROCK" ? "vanilla" : server.kind,
    modpack: server.modpack ?? undefined,
    modpackSource: server.kind === "modpack" ? (server.modpackSource ?? undefined) : undefined,
    modpackVersion: server.modpackVersionId ?? undefined,
    plugins: addonType(server) ? server.plugins : [],
  };
}

/**
 * Whether `version` can't open the world `level` because Minecraft 26.1 or newer
 * saved it (the server would stop at once with "No key dimensions"). If the
 * agent can't say, it lets the change through.
 */
export async function worldTooNew(server: Pick<Server, "id" | "edition">, level: string, version: string) {
  if (server.edition !== "JAVA" || !isPreYearVersion(version)) return false;
  const { worlds } = await listWorlds(server.id, "JAVA").catch(() => ({ worlds: [] as World[] }));
  return worlds.some((w) => w.name === level && w.newGame);
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

// Servers being moved right now, so a retry doesn't start a second move.
const moving = new Set<string>();

/**
 * When a paid plan leaves the server's machine with more sold than it may sell
 * (it was bought for a server already there), moves the server, files and
 * backups, to a machine with room, stopped. Returns the server as it is now, or
 * null while another call is moving it. If no machine has room or the copy
 * fails, it stays where it is.
 */
export async function moveIfFull(server: Server): Promise<Server | null> {
  if (moving.has(server.id)) return null;
  if (server.adminTest || !(await oversold(server.node))) return server;
  const arch = server.edition === "TERRARIA" && server.kind === "tmodloader" ? TMOD_ARCH : undefined;
  const to = await pickNode(server.memoryMb, server.memoryMb, undefined, arch);
  if (!to || to === server.node) return server;
  return (await moveServer(server, to)) ?? server;
}

/**
 * Moves the server, files and backups, to machine `to`, stopped. Returns the
 * server as it is now, or null while another move of it runs or if the copy
 * failed (then it stays where it was).
 */
export async function moveServer(server: Server, to: string): Promise<Server | null> {
  if (moving.has(server.id) || to === server.node) return null;
  const from = nodeById(server.node);
  moving.add(server.id);
  try {
    let copied = true;
    try {
      await copyServer(server.id, from, nodeById(to));
    } catch (err) {
      // Never created on the game host (paid for before its first start): nothing to copy.
      if (!(err instanceof AgentError && err.status === 404)) throw err;
      copied = false;
    }
    const moved = await db.server.update({ where: { id: server.id }, data: { node: to } });
    forgetServerNode(server.id);
    console.info("moved", server.id, "from", from.id, "to", to);
    await syncPeerRoutes().catch((err) => console.error("peer routes not sent", err));
    if (copied) await deleteServer(server.id, from).catch((err) => console.error("old copy not deleted", server.id, from.id, err));
    return moved;
  } catch (err) {
    console.error("move failed", server.id, from.id, "->", to, err);
    // Whatever reached the other machine; the server goes on where it was.
    await deleteServer(server.id, nodeById(to)).catch(() => {});
    return null;
  } finally {
    moving.delete(server.id);
  }
}

// Also the mail names OVH's default DNS zone defines: they have records of
// their own, so the wildcard that sends players to the router doesn't cover them.
const RESERVED = new Set(
  "www api app panel admin mail status help support play ftp imap pop3 smtp webmail autoconfig autodiscover".split(" "),
);

export function isValidSubdomain(s: string) {
  return /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/.test(s) && !s.includes("--") && !RESERVED.has(s);
}
