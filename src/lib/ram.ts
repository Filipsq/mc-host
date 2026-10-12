import type { Plan } from "@prisma/client";
import { plans } from "./plans";

// The RAM calculator on the home page: a rough guide from what the server runs
// and how many people play at once, rounded up to half a gigabyte.

export const RAM_USES = ["vanilla", "plugins", "mods", "bigmods"] as const;
export type RamUse = (typeof RAM_USES)[number];

/** Players online at once, up to; the last group stands for "more". */
export const PLAYER_GROUPS = [5, 10, 20, 40, 100] as const;
export type PlayerGroup = (typeof PLAYER_GROUPS)[number];

const BASE_GB: Record<RamUse, number> = { vanilla: 1.5, plugins: 2, mods: 3, bigmods: 6 };
const PLAYERS_GB: Record<PlayerGroup, number> = { 5: 0, 10: 0.5, 20: 1, 40: 2, 100: 4 };

export function ramNeeded(use: RamUse, players: PlayerGroup) {
  return Math.ceil((BASE_GB[use] + PLAYERS_GB[players]) * 2) / 2;
}

/**
 * The smallest plan with enough memory and room for the players (mod packs
 * need a paid one), or null when even the biggest is too small.
 */
export function planFor(use: RamUse, players: PlayerGroup): Plan | null {
  const gb = ramNeeded(use, players);
  const modded = use === "mods" || use === "bigmods";
  return (
    plans.find((p) => p.ramGb >= gb && (p.maxPlayers === null || p.maxPlayers >= players) && !(modded && p.id === "FREE"))?.id ??
    null
  );
}
