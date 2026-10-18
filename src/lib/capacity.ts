import "server-only";
import type { Server, ServerStatus } from "@prisma/client";
import { db } from "./db";
import { nodes, type GameNode } from "./nodes";

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

/** Memory the machines set aside for game servers, together; 0 means no limit. */
export function memoryLimitMb() {
  const all = nodes();
  return all.some((n) => n.memoryLimitMb <= 0) ? 0 : all.reduce((sum, n) => sum + n.memoryLimitMb, 0);
}

/** Plan memory paid servers may be sold in total; 0 means no limit. */
export function salesLimitMb() {
  return Math.floor(memoryLimitMb() * overbook());
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
    room: node.memoryLimitMb > 0 ? Math.floor(node.memoryLimitMb * overbook()) - (heldOn.get(node.id) ?? 0) : Infinity,
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
 * total on machine `nodeId`, or for a new server on any machine.
 */
export async function canSellMemory(extraMb: number, planMb = extraMb, nodeId?: string) {
  return (await pickNode(planMb, extraMb, nodeId)) !== null;
}

/**
 * The machine a new server of `planMb` goes on: of those it fits on (with room
 * to sell `extraMb` more, for paid plans), the one with the most room left.
 * With `nodeId`, only that machine is considered. Null when none fits.
 */
export async function pickNode(planMb: number, extraMb = planMb, nodeId?: string): Promise<string | null> {
  const candidates = (await roomByNode()).filter(
    ({ node, room }) => (!nodeId || node.id === nodeId) && fitsMachine(node, planMb) && (extraMb <= 0 || room >= extraMb),
  );
  const left = (c: { room: number; freeMb: number }) => (extraMb > 0 ? c.room : c.room - c.freeMb);
  candidates.sort((a, b) => left(b) - left(a));
  return candidates[0]?.node.id ?? null;
}
