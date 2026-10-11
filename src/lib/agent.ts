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
  stopReason?: "sleeping" | "stopped" | "crashed";
};

/** Replaces the container with a new spec (e.g. a new plan), keeping the world. Creates it if missing. */
export async function recreateServer(spec: CreateServerSpec) {
  await agentFetch(`/servers/${spec.id}`, { method: "PUT", body: JSON.stringify(spec), timeoutMs: 5 * 60_000 });
}

export async function getServerState(id: string): Promise<AgentState> {
  const res = await agentFetch(`/servers/${id}`, { timeoutMs: 5_000 });
  return res.json();
}

export async function startServer(id: string) {
  await agentFetch(`/servers/${id}/start`, { method: "POST" });
}

export async function stopServer(id: string) {
  // The agent gives the server up to 60s to save the world.
  await agentFetch(`/servers/${id}/stop`, { method: "POST", timeoutMs: 90_000 });
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
