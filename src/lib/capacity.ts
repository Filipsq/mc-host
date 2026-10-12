import "server-only";
import type { Server, ServerStatus } from "@prisma/client";
import { db } from "./db";

// The game machine has room for MEMORY_LIMIT_MB of plan memory (unset: no
// limit). Paid servers keep their share even while stopped, so a plan is only
// sold while its memory is free. Free servers don't count here: they only use
// memory while awake, and the agent refuses to wake one that doesn't fit.
// Two people paying for the last slot at the same moment can both get it;
// the machine is then slightly over its limit until a server goes away.

const HOLDING: ServerStatus[] = ["PROVISIONING", "RUNNING", "STOPPED"];

/** Plan memory this server holds right now (a paid server that's paid up). */
export function heldMemoryMb(server: Pick<Server, "plan" | "status" | "memoryMb">) {
  return server.plan !== "FREE" && HOLDING.includes(server.status) ? server.memoryMb : 0;
}

/** Whether `extraMb` more memory can be sold to paid servers. */
export async function canSellMemory(extraMb: number) {
  const limit = Number(process.env.MEMORY_LIMIT_MB) || 0;
  if (limit <= 0 || extraMb <= 0) return true;
  const { _sum } = await db.server.aggregate({
    _sum: { memoryMb: true },
    where: { plan: { not: "FREE" }, status: { in: HOLDING } },
  });
  return (_sum.memoryMb ?? 0) + extraMb <= limit;
}
