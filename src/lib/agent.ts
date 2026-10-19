import "server-only";
import type { Edition } from "@prisma/client";
import { db } from "./db";
import { MAIN_NODE, nodeById, nodes, type GameNode } from "./nodes";

// Client for the node agents (see /agent), one per game machine (./nodes).
// Calls about a server go to the machine it's on (Server.node).

export class AgentError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** The agent refused to start a free server because the machine is full. */
export function isFull(err: unknown) {
  return err instanceof AgentError && err.status === 503 && err.message === "full";
}

/** The agent refused to start a server whose files take too much more than its plan's disk space. */
export function isDiskFull(err: unknown) {
  return err instanceof AgentError && err.status === 507 && err.message === "diskFull";
}

// Which machine each server is on, until it moves (forgetServerNode).
const serverNodes = new Map<string, string>();

/** Makes the next call about the server look up its machine again, after a move. */
export function forgetServerNode(id: string) {
  serverNodes.delete(id);
}

async function nodeOfServer(id: string): Promise<GameNode> {
  let node = serverNodes.get(id);
  if (node === undefined) {
    node = (await db.server.findUnique({ where: { id }, select: { node: true } }))?.node ?? MAIN_NODE;
    serverNodes.set(id, node);
  }
  return nodeById(node);
}

/** Calls the agent on `node`, or for /servers/{id}… paths on the machine that server is on. */
async function agentFetch(path: string, init: RequestInit & { timeoutMs?: number; node?: GameNode } = {}) {
  const { timeoutMs = 15_000, node: given, ...rest } = init;
  const serverId = path.match(/^\/servers\/([^/?]+)/)?.[1];
  const node = given ?? (serverId ? await nodeOfServer(decodeURIComponent(serverId)) : nodeById(MAIN_NODE));
  const { url, token } = node;
  if (!url || !token) throw new Error(`agent for machine "${node.id}" isn't set up (AGENT_URL/AGENT_TOKEN or NODES)`);
  let res: Response;
  try {
    res = await fetch(url + path, {
      ...rest,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...rest.headers },
      signal: rest.signal ?? AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (err) {
    throw new AgentError(`agent unreachable: ${(err as Error).message}`, 503);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new AgentError(body.error ?? res.statusText, res.status);
  }
  return res;
}

export type CreateServerSpec = {
  id: string;
  name: string;
  edition: Edition;
  memoryMb: number;
  cpus: number;
  port: number;
  maxPlayers: number;
  version: string;
  hostname: string; // Java only
  password?: string; // Terraria only: what players type to join
  autostop: boolean;
  backupsKept: number; // daily backups the agent keeps; 0 for none
  diskMb: number; // what the server's files may take
  gameMode: string;
  difficulty: string; // Terraria: the world's classic, expert, master or journey
  motd: string; // empty: the name
  pvp: boolean; // Java only
  whitelist: boolean;
  whitelistPlayers: string[];
  onlineMode: boolean; // false: non-premium (Java on Paper only)
  crossplay?: boolean; // Bedrock players join too, through Geyser (Java on Paper only)
  level: string; // the world folder it runs; empty for the image's default
  seed: string; // for a world it hasn't made yet
  levelType: string; // normal, flat, large_biomes or amplified (Java); small, medium or large (Terraria); empty if not chosen
  kind: string; // Java: vanilla, skyblock, oneblock, modpack, fabric, forge or neoforge; Terraria: vanilla, tshock or tmodloader
  modpack?: string; // Modrinth slug or ID, or CurseForge slug, for a modpack
  modpackSource?: string; // "curseforge", or none for Modrinth
  modpackVersion?: string; // Modrinth version ID or CurseForge file ID, for a modpack
  plugins: string[]; // Modrinth project IDs: plugins for Paper servers, mods for mod loader servers; Steam Workshop IDs on tModLoader
};

export async function createServer(spec: CreateServerSpec) {
  // Generous timeout: the agent may need to pull the image first.
  await agentFetch("/servers", { method: "POST", body: JSON.stringify(spec), timeoutMs: 5 * 60_000, node: await nodeOfServer(spec.id) });
}

export type AgentState = {
  state: "created" | "running" | "restarting" | "paused" | "exited" | "dead" | "removing";
  exitCode: number;
  restartCount: number;
  startedAt: string;
  health?: "starting" | "healthy" | "unhealthy";
  stopReason?: "sleeping" | "stopped" | "crashed" | "disk";
  diskMb?: number; // what its files take, as last measured
  diskLimitMb?: number;
};

/**
 * Replaces the container with a new spec (e.g. a new plan), keeping the world. Creates it if missing.
 * The new container starts, unless `keepStopped` is set and the old one wasn't running.
 */
export async function recreateServer(spec: CreateServerSpec, opts: { keepStopped?: boolean } = {}) {
  const query = opts.keepStopped ? "?start=if-running" : "";
  await agentFetch(`/servers/${spec.id}${query}`, { method: "PUT", body: JSON.stringify(spec), timeoutMs: 5 * 60_000 });
}

export type ServerStats = Pick<AgentState, "state" | "health" | "stopReason" | "diskMb" | "diskLimitMb"> & {
  id: string;
  memoryMb: number; // the plan's memory
  memoryUsedMb?: number; // what it uses right now, while running
  players?: number; // online at the last sample, while running
  maxPlayers?: number; // when the server reports it
  startedAt?: string; // when it last started, while running
};

export type HostStats = {
  memoryLimitMb: number; // plan memory the machine is sold up to (0: no limit)
  memoryHeldMb: number; // held now by paid servers and awake free ones
  host: {
    cpus: number;
    load: [number, number, number];
    memoryTotalMb: number;
    memoryAvailableMb: number;
    diskTotalMb: number;
    diskFreeMb: number;
  };
  servers: ServerStats[];
  unreachable: string[]; // extra machines that didn't answer; their servers' states are unknown
};

/** Tells the agents every server's disk limit (MB), replacing what they had; each only uses its own servers'. */
export async function setDiskLimits(limits: Record<string, number>) {
  await Promise.all(
    nodes().map((node) => agentFetch("/disk-limits", { method: "PUT", body: JSON.stringify({ limits }), node })),
  );
}

/** Tells the main machine's router which Java addresses live on other machines, and their routers. */
export async function setPeerRoutes(routes: Record<string, string>) {
  await agentFetch("/peer-routes", { method: "PUT", body: JSON.stringify({ routes }), node: nodeById(MAIN_NODE) });
}

/**
 * Every machine and every server on them, for the admin panel, added up. Throws if the
 * main machine doesn't answer; extra ones that don't are listed in `unreachable`.
 */
export async function getStats(): Promise<HostStats> {
  const all = nodes();
  const results = await Promise.allSettled(
    all.map((node) => agentFetch("/stats", { timeoutMs: 20_000, node }).then((res) => res.json() as Promise<Omit<HostStats, "unreachable">>)),
  );
  if (results[0].status === "rejected") throw results[0].reason;
  const total: HostStats = { ...results[0].value, unreachable: [] };
  results.slice(1).forEach((r, i) => {
    if (r.status === "rejected") {
      console.error(`stats: machine ${all[i + 1].id} unreachable`, r.reason);
      total.unreachable.push(all[i + 1].id);
      return;
    }
    const s = r.value;
    total.memoryLimitMb += s.memoryLimitMb;
    total.memoryHeldMb += s.memoryHeldMb;
    total.host = {
      cpus: total.host.cpus + s.host.cpus,
      load: total.host.load.map((l, j) => l + s.host.load[j]) as HostStats["host"]["load"],
      memoryTotalMb: total.host.memoryTotalMb + s.host.memoryTotalMb,
      memoryAvailableMb: total.host.memoryAvailableMb + s.host.memoryAvailableMb,
      diskTotalMb: total.host.diskTotalMb + s.host.diskTotalMb,
      diskFreeMb: total.host.diskFreeMb + s.host.diskFreeMb,
    };
    total.servers.push(...s.servers);
  });
  return total;
}

export async function getServerState(id: string): Promise<AgentState> {
  const res = await agentFetch(`/servers/${id}`, { timeoutMs: 5_000 });
  return res.json();
}

export async function startServer(id: string) {
  await agentFetch(`/servers/${id}/start`, { method: "POST" });
}

/** Stops a server. A suspended (unpaid) one also gives back the memory it reserved. */
export async function stopServer(id: string, reason?: "suspended") {
  // The agent gives the server up to 60s to save the world.
  const query = reason ? `?reason=${reason}` : "";
  await agentFetch(`/servers/${id}/stop${query}`, { method: "POST", timeoutMs: 90_000 });
}

/** Deletes a server, with its world and backups, from its machine or from `node`. */
export async function deleteServer(id: string, node?: GameNode) {
  await agentFetch(`/servers/${id}`, { method: "DELETE", timeoutMs: 90_000, node });
}

const MOVE_TIMEOUT_MS = 2 * 60 * 60_000;

/**
 * Copies a server's files and backups from machine `from` to `to`, where it
 * doesn't exist yet. The server is stopped on `from` first and left there.
 */
export async function copyServer(id: string, from: GameNode, to: GameNode) {
  const send = async (path: string, res: Response) => {
    await agentFetch(path, {
      method: "PUT",
      node: to,
      body: res.body,
      headers: { "Content-Type": "application/gzip", "Content-Length": res.headers.get("Content-Length") ?? "" },
      ...({ duplex: "half" } as object),
      timeoutMs: MOVE_TIMEOUT_MS,
    });
  };
  await send(`/servers/${id}/import`, await agentFetch(`/servers/${id}/export`, { node: from, timeoutMs: MOVE_TIMEOUT_MS }));
  const { backups } = (await (await agentFetch(`/servers/${id}/backups`, { node: from })).json()) as { backups: Backup[] };
  for (const b of backups) {
    const path = `/servers/${id}/backups/${b.name}`;
    await send(path, await agentFetch(path, { node: from, timeoutMs: MOVE_TIMEOUT_MS }));
  }
}

export async function sendCommand(id: string, command: string): Promise<string> {
  const res = await agentFetch(`/servers/${id}/command`, { method: "POST", body: JSON.stringify({ command }) });
  return (await res.json()).output;
}

export type MetricSample = { t: number; cpu?: number; memMb: number; tps?: number; players: number };
export type MetricsRange = "hour" | "day";
/** Who is online now, and samples every 30 s (hour) or 5-minute averages (day) for the Statistics charts. */
/** `online` is set when more players are connected than have known names (Terraria). */
export type ServerMetrics = { players: string[]; online?: number; maxPlayers?: number; samples: MetricSample[] };

export async function getMetrics(id: string, range: MetricsRange): Promise<ServerMetrics> {
  const res = await agentFetch(`/servers/${id}/metrics?range=${range}`, { timeoutMs: 5_000 });
  return res.json();
}

/** Opens the console log stream (Server-Sent Events) for a server. */
export async function openLogStream(id: string, signal: AbortSignal) {
  return agentFetch(`/servers/${id}/logs`, { signal });
}

export type Backup = { name: string; size: number; createdAt: string };

/** The server's backups, newest first, and how many its plan keeps. */
export async function listBackups(id: string): Promise<{ keep: number; backups: Backup[] }> {
  const res = await agentFetch(`/servers/${id}/backups`, { timeoutMs: 5_000 });
  return res.json();
}

/** Backs up the world now. A big world takes a while to pack. */
export async function createBackup(id: string): Promise<Backup> {
  const res = await agentFetch(`/servers/${id}/backups`, { method: "POST", timeoutMs: 30 * 60_000 });
  return res.json();
}

/** Replaces the world with a backup; a running server is restarted. */
export async function restoreBackup(id: string, name: string) {
  await agentFetch(`/servers/${id}/backups/${name}/restore`, { method: "POST", timeoutMs: 30 * 60_000 });
}

/** Opens a backup file for download. */
export async function openBackupDownload(id: string, name: string, signal: AbortSignal) {
  return agentFetch(`/servers/${id}/backups/${name}`, { signal });
}

export type FileEntry = { name: string; type: "dir" | "file" | "link" | "other"; size: number; modified: string };

/** A folder of the server's files ("." is the top). */
export async function listFiles(id: string, path: string): Promise<{ path: string; entries: FileEntry[]; truncated: boolean }> {
  const res = await agentFetch(`/servers/${id}/files?path=${encodeURIComponent(path)}`, { timeoutMs: 10_000 });
  return res.json();
}

/** Opens a file for download; with max, a bigger file fails with 413. */
export async function openFile(id: string, path: string, opts: { signal?: AbortSignal; max?: number } = {}) {
  const max = opts.max ? `&max=${opts.max}` : "";
  return agentFetch(`/servers/${id}/files/content?path=${encodeURIComponent(path)}${max}`, { signal: opts.signal });
}

/** Saves a file: an upload streamed through from the browser, or an edit. */
export async function writeFile(id: string, path: string, body: ReadableStream<Uint8Array> | string, length?: number) {
  await agentFetch(`/servers/${id}/files/content?path=${encodeURIComponent(path)}`, {
    method: "PUT",
    body,
    headers: { "Content-Type": "application/octet-stream", ...(length !== undefined && { "Content-Length": String(length) }) },
    // A stream needs half-duplex; uploads of big worlds take a while.
    ...({ duplex: "half" } as object),
    timeoutMs: 60 * 60_000,
  });
}

/** Makes a folder, renames or moves, deletes, or unzips in the server's files. */
export async function changeFiles(
  id: string,
  op: { mkdir: string } | { rename: string; to: string } | { remove: string } | { unzip: string },
) {
  const q = (p: string) => encodeURIComponent(p);
  const [method, path] =
    "mkdir" in op
      ? ["POST", `mkdir?path=${q(op.mkdir)}`]
      : "rename" in op
        ? ["POST", `rename?path=${q(op.rename)}&to=${q(op.to)}`]
        : "remove" in op
          ? ["DELETE", `?path=${q(op.remove)}`]
          : ["POST", `unzip?path=${q(op.unzip)}`];
  const res = await agentFetch(`/servers/${id}/files${path.startsWith("?") ? "" : "/"}${path}`, { method, timeoutMs: 10 * 60_000 });
  return res.json();
}

// newGame: saved by Minecraft 26.1 or newer, which 1.21.11 and older can't open.
export type World = { name: string; size: number; modified: string; newGame?: boolean };

/** The server's worlds by name, and the one it runs. */
export async function listWorlds(id: string, edition: Edition): Promise<{ worlds: World[]; active: string }> {
  const res = await agentFetch(`/servers/${id}/worlds?edition=${edition}`, { timeoutMs: 30_000 });
  return res.json();
}

/** Opens a world as a zip for download. */
export async function openWorldDownload(id: string, edition: Edition, name: string, signal: AbortSignal) {
  return agentFetch(`/servers/${id}/worlds/${encodeURIComponent(name)}/download?edition=${edition}`, { signal, timeoutMs: 60 * 60_000 });
}

/** Makes the world `name` from a zip uploaded to `path`, which is deleted afterwards. */
export async function importWorld(id: string, edition: Edition, path: string, name: string) {
  const q = `edition=${edition}&path=${encodeURIComponent(path)}&name=${encodeURIComponent(name)}`;
  await agentFetch(`/servers/${id}/worlds/import?${q}`, { method: "POST", timeoutMs: 10 * 60_000 });
}

/** Deletes a world the server isn't running. */
export async function deleteWorld(id: string, edition: Edition, name: string) {
  await agentFetch(`/servers/${id}/worlds/${encodeURIComponent(name)}?edition=${edition}`, { method: "DELETE", timeoutMs: 5 * 60_000 });
}
