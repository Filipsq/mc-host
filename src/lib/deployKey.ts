import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Server } from "@prisma/client";
import { db } from "./db";
import * as agent from "./agent";
import { agentSpec } from "./servers";
import { clientIp, hit, isLimited } from "./rateLimit";

// A deploy key lets a script put plugins on one server and restart it without signing in:
// GitHub Actions in Filipsq/mc-server builds the network's plugins and puts them on the test
// server (src/app/api/deploy). An admin makes the key on the server's admin page; it's shown
// once and only its SHA-256 is kept. It can only touch plugins/, so it can't read the world,
// change settings or reach any other server. Making a new key drops the old one.

const PREFIX = "mchd_";
const SERVER_ID = /^[a-z0-9]{20,40}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;

/** Wrong keys from one address before it has to wait. */
const FAILS_MAX = 10;
const FAILS_WINDOW_MS = 15 * 60_000;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** A new key for the server, as the script sends it, and the hash to keep. */
export function newDeployKey(serverId: string) {
  const key = `${PREFIX}${serverId}_${randomBytes(32).toString("base64url")}`;
  return { key, hash: sha256(key) };
}

/** The server whose key the request carries (Authorization: Bearer mchd_...), or null. */
export async function serverForDeployKey(req: Request): Promise<Server | null> {
  const ip = `deploy:${clientIp(req.headers)}`;
  if (isLimited(ip, FAILS_MAX, FAILS_WINDOW_MS)) return null;
  const key = req.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1] ?? "";
  const server = await serverFor(key);
  if (!server) hit(ip);
  return server;
}

async function serverFor(key: string) {
  if (!key.startsWith(PREFIX)) return null;
  const rest = key.slice(PREFIX.length);
  const cut = rest.indexOf("_");
  const id = rest.slice(0, cut);
  if (cut < 0 || !SERVER_ID.test(id) || !SECRET.test(rest.slice(cut + 1))) return null;
  const server = await db.server.findUnique({ where: { id } });
  if (!server?.deployKeyHash || server.status === "SUSPENDED" || server.status === "AWAITING_PAYMENT") return null;
  const a = Buffer.from(sha256(key), "hex");
  const b = Buffer.from(server.deployKeyHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b) ? server : null;
}

/**
 * Files the key may write or delete: in plugins/ and one folder below it (a plugin's
 * config), names of letters, digits, dot, dash and underscore, never starting with a dot.
 */
export function isDeployPath(path: string) {
  return /^plugins\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}\/)?[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$/.test(path);
}

/** Stops the server and starts it again so it loads the new plugins. */
export async function restartForDeploy(server: Server): Promise<{ error?: "full" | "diskFull" | "failed" }> {
  try {
    await agent.stopServer(server.id).catch((err) => {
      // Not built on its machine yet: starting below builds it.
      if (!(err instanceof agent.AgentError && err.status === 404)) throw err;
    });
    if (server.pluginsPending) await agent.recreateServer(agentSpec(server));
    else
      await agent.startServer(server.id).catch(async (err) => {
        if (!(err instanceof agent.AgentError && err.status === 404)) throw err;
        await agent.recreateServer(agentSpec(server));
      });
  } catch (err) {
    if (agent.isFull(err)) return { error: "full" };
    if (agent.isDiskFull(err)) return { error: "diskFull" };
    console.error("deploy: restart failed", server.id, err);
    return { error: "failed" };
  }
  await db.server.update({ where: { id: server.id }, data: { status: "RUNNING", pluginsPending: false, queuedAt: null } });
  return {};
}
