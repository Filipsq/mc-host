import "server-only";
import { cache } from "react";
import { Prisma, type Server } from "@prisma/client";
import { db } from "./db";
import {
  AgentError,
  copyServer,
  deleteServer,
  forgetServerNode,
  getHost,
  getServerState,
  listWorlds,
  portInUse,
  recreateServer,
  setHostAliases,
  setPeerRoutes,
  usedPorts,
  type AgentState,
  type CreateServerSpec,
  type World,
} from "./agent";
import { getServerFor } from "./access";
import { oversold, pickNode, rankNodes } from "./capacity";
import { planById } from "./plans";
import { backupsFor, diskGbFor, hasOwnDomain } from "./addons";
import { requiredArch } from "./terraria";
import { MAIN_NODE, nodeById, nodes, routerAddress } from "./nodes";
import { addonType, canCrossplay, canRunNonPremium, pinsFor, sitePlugin, withNeededPlugins } from "./plugins";
import { isPreYearVersion, maxPlayersFor, viewDistanceMax } from "./settings";
import { isModLoader } from "./modpacks";
import { xboxOn } from "./xbox";
import { hubLinkSpec } from "./hubLink";
import { adBonus } from "./adReward";
import { kindText, logServerEvent } from "./serverEvents";

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
    const live = liveStateFrom(server, agent);
    noteCrash(server, agent);
    return { live, agent };
  } catch (err) {
    if (err instanceof AgentError) return { live: liveStateFrom(server, err.status === 404 ? "missing" : "unknown") };
    throw err;
  }
}

/**
 * A crash or an auto-repair the agent reports goes on the server's history once
 * (keyed by when that run started), so admins see crashes without the console.
 */
function noteCrash(server: Pick<Server, "id" | "status"> & { ownerId?: string }, agent: AgentState) {
  if (agent.state === "running" || !agent.startedAt) return;
  const kind = agent.stopReason === "crashed" && server.status !== "STOPPED" ? "crash" : agent.stopReason === "repairing" ? "repair" : null;
  if (!kind) return;
  void logServerEvent({ id: server.id, ownerId: server.ownerId ?? "" }, kind, agent.exitCode ? `kod ${agent.exitCode}` : "", { system: true, ref: agent.startedAt });
}

/** getLiveDetails asked once per request, so the panel's frame and its page share the answer. */
export const getLiveDetailsOnce = cache((id: string, status: Server["status"]) => getLiveDetails({ id, status }));

type KnownState = Pick<AgentState, "state" | "health" | "stopReason">;

/**
 * The same from an agent answer already in hand: "missing" when the game host
 * has no container for the server, "unknown" when it couldn't be asked.
 */
export function liveStateFrom(server: Pick<Server, "status">, s: KnownState | "missing" | "unknown"): LiveState {
  if (server.status === "AWAITING_PAYMENT") return "awaitingPayment";
  if (server.status === "SUSPENDED") return "suspended";
  // Paid but not yet created on the game host (the billing job retries).
  // No container on its machine otherwise (e.g. moved and not built yet): off, and Start builds it.
  if (s === "missing") return server.status === "PROVISIONING" ? "starting" : "offline";
  if (s === "unknown") return "unknown";
  if (s.state === "restarting") return "restarting";
  if (s.state === "running") return s.health === "healthy" ? "online" : "starting";
  if (s.stopReason === "disk") return "diskFull";
  // Crashed on something the agent fixes, and about to be started again by it.
  if (s.stopReason === "repairing") return "starting";
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
  const gone = await db.server.delete({ where: { id: server.id } });
  // Its linked servers stop sending players to it (src/lib/links.ts).
  if (gone.linkGroup) {
    const mates = await db.server.findMany({ where: { ownerId: gone.ownerId, linkGroup: gone.linkGroup }, select: { id: true } });
    if (mates.length) {
      const { setLinks } = await import("./links");
      await setLinks(gone.ownerId, mates[0].id, mates.slice(1).map((m) => m.id)).catch((err) => console.error("unlink failed", gone.id, err));
    }
  }
}

// Java servers' own ports sit behind the router (which owns 25565), so the
// pool must not include 25565. Bedrock (UDP) and Terraria (TCP) players connect
// to these ports directly.
const PORT_START = Number(process.env.PORT_RANGE_START ?? 30000);
const PORT_END = Number(process.env.PORT_RANGE_END ?? 30999);

/**
 * The lowest port free on machine `node` that isn't in `busy`, or null if none is. Free means no
 * server has it and nothing on the machine holds it: a container left behind, or a stopped one still
 * bound to a port its server moved off, which the Bedrock waker keeps open (on n6 on 2026-11-20 it
 * held six ports the database thought free, and every new server there failed to start).
 */
export async function freePortOn(node: string, busy: ReadonlySet<number> = new Set()): Promise<number | null> {
  const [taken, held] = await Promise.all([
    db.server.findMany({ where: { node, port: { gte: PORT_START, lte: PORT_END } }, select: { port: true } }),
    usedPorts(nodeById(node)),
  ]);
  const used = new Set(taken.map((s) => s.port));
  let port = PORT_START;
  while ((used.has(port) || busy.has(port) || held.has(port)) && port <= PORT_END) port++;
  return port > PORT_END ? null : port;
}

/**
 * Puts the server on machine `to`, with a new port if its own is taken there.
 * Returns null if `to` has no free port.
 */
export async function setNode(server: Server, to: string): Promise<Server | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const clash = server.port !== null && (await db.server.count({ where: { node: to, port: server.port, NOT: { id: server.id } } })) > 0;
    const port = clash ? await freePortOn(to) : server.port;
    if (port === null) return null;
    try {
      const moved = await db.server.update({ where: { id: server.id }, data: { node: to, port } });
      if (server.node !== to) await logServerEvent(server, "move", `${server.node} → ${to}`);
      return moved;
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    }
  }
  return null;
}

/**
 * Creates the server row with the lowest port free on its machine. The unique index on node and port
 * settles races between two simultaneous creations; the loser retries.
 * Returns "subdomainTaken" if the address is already in use, or null if no port is free.
 */
export async function createServerRecord(data: Omit<Prisma.ServerUncheckedCreateInput, "port">) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const port = await freePortOn(data.node ?? MAIN_NODE);
    if (port === null) return null;
    try {
      // Mods' jetpacks and wings need flying, or the server kicks their players.
      const allowFlight = data.allowFlight ?? (data.kind === "modpack" || isModLoader(data.kind));
      const created = await db.server.create({ data: { ...data, allowFlight, port } });
      await logServerEvent(created, "created", `${created.edition === "JAVA" ? kindText(created) : `${created.edition.toLowerCase()} ${created.version}`} · ${created.plan} · ${created.node}`);
      return created;
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
      const fields = (err.meta?.target as string[] | undefined) ?? [];
      if (fields.includes("subdomain")) return "subdomainTaken" as const;
    }
  }
  return null;
}

/**
 * Moves the server to the lowest free port that isn't in `busy`: ports its
 * machine holds though no server has them (e.g. a container left behind).
 * Returns null if none is free.
 */
export async function changePort(server: Server, busy: ReadonlySet<number>): Promise<Server | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const port = await freePortOn(server.node, busy);
    if (port === null) return null;
    try {
      return await db.server.update({ where: { id: server.id }, data: { port } });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    }
  }
  return null;
}

const GAME_DOMAIN = process.env.GAME_DOMAIN ?? "localhost";

/** The Java address: every machine's servers are reached through the main machine's router. */
export function javaHost(server: Pick<Server, "subdomain">) {
  return `${server.subdomain}.${GAME_DOMAIN}`;
}

/** What players type in the game to join: a Java address, or a host and port (Bedrock, Terraria). */
export function joinAddress(server: Pick<Server, "edition" | "subdomain" | "port" | "node" | "plan" | "addons" | "customDomain" | "domainUntil">) {
  // With the domain add-on and the owner's domain set, players type that instead.
  if (server.edition === "JAVA") return { host: (hasOwnDomain(server) && server.customDomain) || javaHost(server), port: null };
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

// Simple Voice Chat's own UDP port: the server's port plus this (agent/voice.go keeps the same number).
const VOICE_PORT_OFFSET = 1000;

/**
 * Where players' games reach Simple Voice Chat: straight to the server's
 * machine, like Bedrock players, on a port of its own. The agent sets the
 * plugin up with it; every Java server has it, used or not.
 */
export function voiceAddress(server: Pick<Server, "edition" | "subdomain" | "port" | "node">) {
  if (server.edition !== "JAVA" || !server.port) return null;
  return { host: bedrockHost(server), port: server.port + VOICE_PORT_OFFSET };
}

// BlueMap's web map port: the server's port plus this (agent/webmap.go keeps the same number).
const WEB_MAP_PORT_OFFSET = 2000;

/**
 * Where BlueMap's map opens in a browser: the server's own machine, on a TCP
 * port of its own (plain HTTP). Every Java server has it, used or not.
 */
export function webMapAddress(server: Pick<Server, "edition" | "subdomain" | "port" | "node">) {
  if (server.edition !== "JAVA" || !server.port) return null;
  const host = bedrockHost(server);
  const port = server.port + WEB_MAP_PORT_OFFSET;
  return { host, port, url: `http://${host}:${port}` };
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

/** Tells every machine's router which own domains (the "domain" add-on) lead to which Java address (see agent/aliases.go). */
export async function syncHostAliases() {
  const servers = await db.server.findMany({
    where: { customDomain: { not: null }, edition: "JAVA", OR: [{ plan: { not: "FREE" }, addons: { has: "domain" } }, { domainUntil: { gt: new Date() } }] },
    select: { customDomain: true, subdomain: true, plan: true, addons: true, edition: true, domainUntil: true },
  });
  await setHostAliases(Object.fromEntries(servers.filter((s) => hasOwnDomain(s)).map((s) => [s.customDomain!, javaHost(s)])));
}

/** The address as players type it. */
export function addressLabel(server: Parameters<typeof joinAddress>[0]) {
  const { host, port } = joinAddress(server);
  return server.edition === "JAVA" ? host : `${host}:${port}`;
}

/** The container spec the agent needs, derived from the server's plan. */
export function agentSpec(server: Server): CreateServerSpec {
  const plan = planById(server.plan);
  // Watched ads give a free server more slots and RAM for a day (adReward.ts).
  const bonus = adBonus(server);
  const players = maxPlayersFor(server, plan);
  return {
    id: server.id,
    name: server.name,
    edition: server.edition,
    memoryMb: plan.ramGb * 1024 + bonus.memoryMb,
    cpus: plan.cpus,
    port: server.port!,
    maxPlayers: players > 0 ? players + bonus.slots : 0,
    version: server.version,
    hostname: server.edition === "JAVA" ? javaHost(server) : "",
    password: server.edition === "TERRARIA" || server.edition === "VALHEIM" ? (server.serverPassword ?? "") : undefined,
    autostop: !plan.alwaysOn,
    backupsKept: backupsFor(server),
    diskMb: diskGbFor(server) * 1024,
    gameMode: server.gameMode,
    difficulty: server.difficulty,
    motd: server.motd,
    pvp: server.pvp,
    whitelist: server.whitelist && (server.edition === "JAVA" || server.edition === "BEDROCK"),
    whitelistPlayers: server.whitelistPlayers,
    onlineMode: server.onlineMode || !canRunNonPremium(server),
    ownLogin: !server.onlineMode && server.ownLogin,
    crossplay: server.crossplay && canCrossplay(server),
    voiceHost: voiceAddress(server)?.host,
    xbox: xboxOn(server),
    allowFlight: server.allowFlight,
    hardcore: server.hardcore,
    commandBlocks: server.commandBlocks,
    allowNether: server.allowNether,
    allowEnd: server.allowEnd,
    forceGamemode: server.forceGamemode,
    spawnMonsters: server.spawnMonsters,
    spawnProtection: server.spawnProtection,
    // A pick from a paid plan never goes past what the plan has now.
    viewDistance: server.viewDistance == null ? undefined : Math.min(server.viewDistance, viewDistanceMax(server.plan)),
    resourcePack:
      server.resourcePack == null || server.edition !== "JAVA"
        ? undefined
        : {
            url: server.resourcePack,
            sha1: server.resourcePackSha1 ?? "",
            required: server.resourcePack !== "" && server.resourcePackRequired,
            prompt: server.resourcePackPrompt,
          },
    level: server.level ?? "",
    seed: server.levelSeed ?? "",
    levelType: server.levelType ?? "",
    kind: server.edition === "BEDROCK" ? "vanilla" : server.kind,
    modpack: server.modpack ?? undefined,
    modpackSource: server.kind === "modpack" ? (server.modpackSource ?? undefined) : undefined,
    modpackVersion: server.modpackVersionId ?? undefined,
    // Picks a non-premium pack's login mod (agent/login.go loginScript).
    modpackLoader: server.kind === "modpack" ? (server.modpackLoader ?? undefined) : undefined,
    // Plugins from Hangar and SpigotMC are files the panel put there itself.
    plugins: addonType(server) ? withNeededPlugins(server.plugins.filter((p) => !sitePlugin(p))) : [],
    // Builds the owner picked in Plugins for this version.
    pluginVersions: addonType(server) === "plugin" || addonType(server) === "mod" ? pinsFor(server) : undefined,
    // Linked servers (src/lib/links.ts), kept as "<name>=<java address>".
    links:
      server.edition === "JAVA"
        ? server.links.flatMap((l) => {
            const i = l.indexOf("=");
            return i > 0 ? [{ name: l.slice(0, i), host: l.slice(i + 1) }] : [];
          })
        : [],
    hubLink: hubLinkSpec(server),
  };
}

/**
 * Whether `version` can't open the world `level` because Minecraft 26.1 or newer
 * saved it (the server would stop at once with "No key dimensions"). A world not
 * saved yet, or one the agent can't list, counts as too new while the server runs
 * 26.1+: it saves the world as it stops, before the new version starts.
 */
export async function worldTooNew(server: Pick<Server, "id" | "edition" | "version" | "status">, level: string, version: string) {
  if (server.edition !== "JAVA" || !RELEASE_NUMBER.test(version)) return false;
  const listed = await listWorlds(server.id, "JAVA").catch(() => null);
  const world = listed?.worlds.find((w) => w.name === level);
  if (world) return worldNeedsNewer(world, version);
  return isPreYearVersion(version) && !isPreYearVersion(server.version) && server.status === "RUNNING";
}

const RELEASE_NUMBER = /^\d+\.\d+(\.\d+)?$/;

/**
 * Whether Minecraft `version` is too old to open `world`: 1.x can't open what
 * 26.1+ saved, and no version opens what a newer one saved (Paper 26.1.2 on a
 * world 26.3 had played stopped with "chunk saved with newer version of
 * minecraft", 2026-11-17). "Najnowsza" (LATEST) opens anything.
 */
export function worldNeedsNewer(world: Pick<World, "newGame" | "savedBy">, version: string) {
  if (!RELEASE_NUMBER.test(version)) return false;
  if (world.newGame && isPreYearVersion(version)) return true;
  return !!world.savedBy && RELEASE_NUMBER.test(world.savedBy) && compareReleases(version, world.savedBy) < 0;
}

function compareReleases(a: string, b: string) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
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

/**
 * Starts a server whose start failed because its port was taken: its container
 * may still publish a port it no longer has (lre on n6, 2026-11-18: the
 * container held 30051, which the agent kept open for another, sleeping
 * crossplay server, while its own was 30094). It is rebuilt with its own port
 * and started; if that one is taken too, it moves to the next free port.
 * Returns the server as it now is, or null if no port worked.
 */
export async function startOnFreePort(server: Server): Promise<Server | null> {
  const busy = new Set<number>();
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await recreateServer(agentSpec(server));
      return server;
    } catch (err) {
      if (!portInUse(err) || server.port === null) throw err;
      busy.add(server.port);
      const moved = await changePort(server, busy);
      if (!moved) return null;
      console.info("port taken, moved", server.id, "from", server.port, "to", moved.port);
      server = moved;
    }
  }
  return null;
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
  const to = await pickNode(server.memoryMb, server.memoryMb, undefined, requiredArch(server));
  if (!to || to === server.node) return server;
  return (await moveServer(server, to)) ?? server;
}

// What the agent wants free before it starts a free server (agent/capacity.go: its
// starting share, plus the larger of 1 GB and 10% of the machine), and some more so
// the copy isn't for nothing; and disk for its files.
const START_MB = 1536 + 512;
const START_DISK_MB = 10 * 1024;

function hasRoomToStart(host: { memoryTotalMb: number; memoryAvailableMb: number; diskFreeMb: number }) {
  return host.memoryAvailableMb >= START_MB + Math.max(1024, host.memoryTotalMb / 10) && host.diskFreeMb >= START_DISK_MB;
}

/**
 * When a free server's machine has no memory awake for it, moves it to the
 * machine best placed for free servers and starts it there. Returns the moved
 * server, or null if there's no other machine or the copy failed.
 */
export async function startElsewhere(server: Server): Promise<Server | null> {
  const ranked = (await rankNodes(server.memoryMb, 0, undefined, requiredArch(server))).filter((n) => n !== server.node);
  // Only a machine that really has the memory and disk for it now: the one best placed
  // by plans sold may be just as full, and the server would be copied there for nothing.
  const hosts = await Promise.all(ranked.map((n) => getHost(nodeById(n))));
  const roomy = ranked
    .map((id, i) => ({ id, host: hosts[i] }))
    .filter(({ host }) => host && hasRoomToStart(host))
    .sort((a, b) => b.host!.memoryAvailableMb - a.host!.memoryAvailableMb);
  const to = roomy[0]?.id;
  if (!to) return null;
  const moved = await moveServer(server, to);
  if (!moved) return null;
  console.info("free server moved to start", server.id, server.node, "->", to);
  await recreateServer(agentSpec(moved));
  return moved;
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
    const moved = await setNode(server, to);
    if (!moved) throw new Error(`no free port on ${to}`);
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
  // hub and lobby: the mchosting.pl network's hub (src/lib/hubLink.ts HUB_HOST).
  "www api app panel admin mail status help support play ftp imap pop3 smtp webmail autoconfig autodiscover hub lobby".split(" "),
);

export function isValidSubdomain(s: string) {
  return /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/.test(s) && !s.includes("--") && !RESERVED.has(s);
}
