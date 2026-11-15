import type { Server } from "@prisma/client";

// A free server's reward for a rewarded ad watched to the end (Google Ad Manager,
// the "Obejrzyj reklamę" button on its panel): more player slots and RAM for a day.
// Two ads a day per server; the second adds to the first.

export const AD_SLOTS = 10;
export const AD_MEMORY_MB = 256;
export const AD_HOURS = 24;
export const AD_WATCHES_PER_DAY = 2;
export const AD_WINDOW_MS = AD_HOURS * 3600_000;

type Boosted = Pick<Server, "plan" | "adBoost" | "adBoostUntil">;

/** How many rewards the server has right now (0 once they end or on a paid plan). */
export function adBoostLevel(server: Boosted, now = new Date()) {
  if (server.plan !== "FREE" || !server.adBoostUntil || server.adBoostUntil <= now) return 0;
  return Math.min(server.adBoost, AD_WATCHES_PER_DAY);
}

/** The level and end after one more ad: a running reward grows and lasts a full day again. */
export function adBoostAfterWatch(server: Boosted, now = new Date()) {
  return { adBoost: Math.min(adBoostLevel(server, now) + 1, AD_WATCHES_PER_DAY), adBoostUntil: new Date(now.getTime() + AD_WINDOW_MS) };
}

/** What the rewards add on top of the plan. */
export function adBonus(server: Boosted, now = new Date()) {
  const level = adBoostLevel(server, now);
  return { slots: level * AD_SLOTS, memoryMb: level * AD_MEMORY_MB };
}
