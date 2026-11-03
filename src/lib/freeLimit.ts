import { db } from "@/lib/db";

/**
 * How many free servers one account may have: FREE_SERVERS_PER_USER in deploy/.env,
 * 3 when unset, 0 for no limit. Free servers hold no memory while asleep, but each
 * one keeps its files on disk and wakes onto a machine shared with everyone else.
 */
export function freeServerLimit(): number {
  const raw = process.env.FREE_SERVERS_PER_USER;
  const n = raw === undefined || raw.trim() === "" ? 3 : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 3;
}

/** True when this account can't make another free server (an admin's test servers don't count). */
export async function freeLimitReached(userId: string): Promise<boolean> {
  const limit = freeServerLimit();
  if (limit === 0) return false;
  const count = await db.server.count({ where: { ownerId: userId, plan: "FREE", adminTest: false } });
  return count >= limit;
}
