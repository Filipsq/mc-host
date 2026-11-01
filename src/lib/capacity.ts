import "server-only";
import type { Server, ServerStatus } from "@prisma/client";
import { db } from "./db";
import { MAIN_NODE, nodes, type GameNode } from "./nodes";

// Each game machine has room for its memory limit of plan memory (MEMORY_LIMIT_MB
// on the main one, memoryLimitMb in NODES on the others; unset: no limit).
// Paid servers keep their share even while stopped, so a plan is only sold
// while its machine has the memory free. Free servers don't count here: they only use
// memory while awake, and the agent refuses to wake one that doesn't fit.
// With MEMORY_OVERBOOK (e.g. 2) paid plans are sold up to that many times
// the limit, since stopped servers use nothing and Java servers only what
// their players need; the agent then counts only running servers.
// Two people paying for the last slot at the same moment can both get it;
// the machine is then slightly over its limit until a server goes away.

const HOLDING: ServerStatus[] = ["PROVISIONING", "RUNNING", "STOPPED"];

/** Plan memory this server holds right now (a paid server that's paid up). */
export function heldMemoryMb(server: Pick<Server, "plan" | "status" | "memoryMb">) {
  return server.plan !== "FREE" && HOLDING.includes(server.status) ? server.memoryMb : 0;
}

/** How many times the machine's server memory is sold to paid plans (1: not overbooked). */
export function overbook() {
  const factor = Number(process.env.MEMORY_OVERBOOK);
  return factor >= 1 ? factor : 1;
}

/** How many times this machine's memory is sold to paid plans. */
export function overbookOf(node: GameNode) {
  return node.overbook ?? overbook();
}

/** Memory the machines set aside for game servers, together; 0 means no limit. */
export function memoryLimitMb() {
  const all = nodes();
  return all.some((n) => n.memoryLimitMb <= 0) ? 0 : all.reduce((sum, n) => sum + n.memoryLimitMb, 0);
}

/** Plan memory paid servers may be sold in total; 0 means no limit. */
export function salesLimitMb() {
  return memoryLimitMb() && nodes().reduce((sum, n) => sum + Math.floor(n.memoryLimitMb * overbookOf(n)), 0);
}

/** How much more plan memory each machine can sell to paid servers (Infinity: no limit). */
async function roomByNode() {
  const held = await db.server.groupBy({
    by: ["node"],
    _sum: { memoryMb: true },
    where: { plan: { not: "FREE" }, status: { in: HOLDING } },
  });
  const free = await db.server.groupBy({ by: ["node"], _sum: { memoryMb: true }, where: { plan: "FREE" } });
  const heldOn = new Map(held.map((h) => [h.node, h._sum.memoryMb ?? 0]));
  const freeOn = new Map(free.map((h) => [h.node, h._sum.memoryMb ?? 0]));
  return nodes().map((node) => ({
    node,
    room: node.memoryLimitMb > 0 ? Math.floor(node.memoryLimitMb * overbookOf(node)) - (heldOn.get(node.id) ?? 0) : Infinity,
    // Free servers hold nothing, but each machine wakes only a few at once, so they're spread out too.
    freeMb: freeOn.get(node.id) ?? 0,
  }));
}

/** Whether a server of `planMb` fits on this machine at all: overbooking shares memory, but one server can't get more than is there. */
function fitsMachine(node: GameNode, planMb: number) {
  return node.memoryLimitMb <= 0 || planMb <= node.memoryLimitMb;
}

/**
 * Whether `extraMb` more memory can be sold to a paid server of `planMb` in
 * total on machine `nodeId`, or on any machine (a server already on a full one
 * moves when the plan is paid for, see moveIfFull in servers.ts).
 */
export async function canSellMemory(extraMb: number, planMb = extraMb, nodeId?: string) {
  return (await pickNode(planMb, extraMb, nodeId)) !== null;
}

/**
 * The machine a new server of `planMb` goes on: of those it fits on (with room
 * to sell `extraMb` more, for paid plans), the one with the most room left.
 * With `nodeId`, only that machine is considered; with `arch`, only machines
 * with that processor (tModLoader runs on amd64 only). Null when none fits.
 */
export async function pickNode(planMb: number, extraMb = planMb, nodeId?: string, arch?: string): Promise<string | null> {
  return (await rankNodes(planMb, extraMb, nodeId, arch))[0] ?? null;
}

/** Every machine pickNode could choose, best first. */
export async function rankNodes(planMb: number, extraMb = planMb, nodeId?: string, arch?: string): Promise<string[]> {
  const all = await roomByNode();
  // Free servers (extraMb 0) stay off the main machine, which also runs the site,
  // whenever there's another machine for them.
  const free = extraMb <= 0 && all.some((c) => c.node.id !== MAIN_NODE);
  const candidates = all.filter(
    ({ node, room }) =>
      (!nodeId || node.id === nodeId) &&
      (!arch || node.arch === arch) &&
      !(free && node.id === MAIN_NODE) &&
      fitsMachine(node, planMb) &&
      (extraMb <= 0 || room >= extraMb),
  );
  // Free servers go where the most is left for the machine's size, so a small
  // machine doesn't get as many as a big one.
  const left = (c: { node: GameNode; room: number; freeMb: number }) =>
    extraMb > 0 ? c.room : (c.room - c.freeMb) / Math.max(c.node.memoryLimitMb, 1);
  candidates.sort((a, b) => left(b) - left(a));
  return candidates.map((c) => c.node.id);
}

/** Whether the paid servers on machine `nodeId` hold more memory than it may sell. */
export async function oversold(nodeId: string) {
  const here = (await roomByNode()).find((c) => c.node.id === nodeId);
  return here !== undefined && here.room < 0;
}
