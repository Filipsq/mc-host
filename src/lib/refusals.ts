import "server-only";
import type { Plan } from "@prisma/client";
import { db } from "./db";

// Times someone was turned away: no room for a new or waking server, or a machine
// that didn't answer. Counted on the admin overview, so it's clear when to buy a machine.

export const REFUSAL_KINDS = ["createFull", "startFull", "createSoldOut", "upgradeSoldOut", "createFailed", "startFailed"] as const;
export type RefusalKind = (typeof REFUSAL_KINDS)[number];

/** Notes a refusal; never fails the request it's called from. */
export async function logRefusal(kind: RefusalKind, data: { plan: Plan; userId?: string; serverId?: string; node?: string }) {
  await db.refusal.create({ data: { kind, ...data } }).catch((err) => console.error("refusal not saved", kind, err));
}
