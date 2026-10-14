import "server-only";
import type { Edition } from "@prisma/client";

// Client for the node agent (see /agent). For now there is one game host,
// configured by AGENT_URL; later the scheduler will pick a node per server.

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

function config() {
  const url = process.env.AGENT_URL;
  const token = process.env.AGENT_TOKEN;
  if (!url || !token) throw new Error("AGENT_URL and AGENT_TOKEN must be set");
  return { url, token };
}

async function agentFetch(path: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const { url, token } = config();
  const { timeoutMs = 15_000, ...rest } = init;
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
  autostop: boolean;
  backupsKept: number; // daily backups the agent keeps; 0 for none
  diskMb: number; // what the server's files may take
  gameMode: string;
  difficulty: string;
  motd: string; // empty: the name
  pvp: boolean; // Java only
  whitelist: boolean;
  whitelistPlayers: string[];
  onlineMode: boolean; // false: non-premium (Java on Paper only)
  crossplay?: boolean; // Bedrock players join too, through Geyser (Java on Paper only)
  level: string; // the world folder it runs; empty for the image's default
  seed: string; // for a world it hasn't made yet
  levelType: string; // normal, flat, large_biomes or amplified (Java); empty if not chosen
  kind: string; // Java only: vanilla, skyblock, oneblock, modpack, fabric, forge or neoforge
  modpack?: string; // Modrinth slug or ID, or CurseForge slug, for a modpack
  modpackSource?: string; // "curseforge", or none for Modrinth
  modpackVersion?: string; // Modrinth version ID or CurseForge file ID, for a modpack
  plugins: string[]; // Modrinth project IDs: plugins for Paper servers, mods for mod loader servers
};

export async function createServer(spec: CreateServerSpec) {
  // Generous timeout: the agent may need to pull the image first.
  await agentFetch("/servers", { method: "POST", body: JSON.stringify(spec), timeoutMs: 5 * 60_000 });
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
};

/** Tells the agent every server's disk limit (MB), replacing what it had. */
export async function setDiskLimits(limits: Record<string, number>) {
  await agentFetch("/disk-limits", { method: "PUT", body: JSON.stringify({ limits }) });
}

/** The machine and every server on it, for the admin panel. */
export async function getStats(): Promise<HostStats> {
  const res = await agentFetch("/stats", { timeoutMs: 20_000 });
  return res.json();
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

export async function deleteServer(id: string) {
  await agentFetch(`/servers/${id}`, { method: "DELETE", timeoutMs: 90_000 });
}

export async function sendCommand(id: string, command: string): Promise<string> {
  const res = await agentFetch(`/servers/${id}/command`, { method: "POST", body: JSON.stringify({ command }) });
  return (await res.json()).output;
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

export type World = { name: string; size: number; modified: string };

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
