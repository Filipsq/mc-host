import type { Server } from "@prisma/client";

// Terraria servers: plain Terraria or TShock (Terraria with admin commands,
// permissions and anti-cheat), on the same plans as Minecraft. The agent runs
// them (agent/terraria.go); players join by address and port in the game's
// "Join via IP". The world's size and difficulty are picked once, when the
// world is made; the seed too.

export const TERRARIA_KINDS = ["vanilla", "tshock"] as const;
export const WORLD_SIZES = ["small", "medium", "large"] as const;
export const WORLD_DIFFICULTIES = ["classic", "expert", "master", "journey"] as const;
export type TerrariaKind = (typeof TERRARIA_KINDS)[number];
export type WorldSize = (typeof WORLD_SIZES)[number];
export type WorldDifficulty = (typeof WORLD_DIFFICULTIES)[number];

export const isTerraria = (s: Pick<Server, "edition">) => s.edition === "TERRARIA";
export const isTerrariaKind = (k: unknown): k is TerrariaKind => TERRARIA_KINDS.includes(k as TerrariaKind);
export const isWorldSize = (s: unknown): s is WorldSize => WORLD_SIZES.includes(s as WorldSize);
export const isWorldDifficulty = (d: unknown): d is WorldDifficulty => WORLD_DIFFICULTIES.includes(d as WorldDifficulty);

/** What players type to join: printable characters without spaces, as the agent accepts. */
export const SERVER_PASSWORD = /^[\x21-\x7e]{1,32}$/;
export const SERVER_PASSWORD_MAX = 32;

/** A world seed: letters, digits, spaces (for the special seeds like "not the bees"), "_" and "-". */
export const WORLD_SEED = /^[\p{L}\p{N} _-]{1,32}$/u;
