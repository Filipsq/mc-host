import type { Plan, Server } from "@prisma/client";

// Terraria servers: plain Terraria, TShock (Terraria with admin commands,
// permissions and anti-cheat) or tModLoader (Terraria with mods from the Steam
// Workshop), on the same plans as Minecraft. The agent runs
// them (agent/terraria.go); players join by address and port in the game's
// "Join via IP". The world's size and difficulty are picked once, when the
// world is made; the seed too.

export const TERRARIA_KINDS = ["vanilla", "tshock", "tmodloader"] as const;
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

// tModLoader: the owner picks mods from the Steam Workshop by link or ID, kept
// in Server.plugins; the server downloads them on every start (agent/terraria.go).
// It needs more memory than plain Terraria and runs on x86 machines only, so
// it's for paid plans, on a machine whose GAME_ARCH / NODES arch is amd64.

export const TMOD_ARCH = "amd64";
export const TMOD_MIN_PLAN: Plan = "STARTER";
export const isTmodloader = (s: Pick<Server, "edition" | "kind">) => s.edition === "TERRARIA" && s.kind === "tmodloader";

/**
 * The processor a server's machine must have, if any: tModLoader and Mojang's
 * Bedrock server are x86 only, as are Valheim's server and Hytale's downloader
 * (src/lib/otherGames.ts). Bedrock does start emulated on an Arm machine
 * but never answers players there (seen on the main machine, 2026-10-25).
 */
export const requiredArch = (s: Pick<Server, "edition" | "kind">) =>
  s.edition === "BEDROCK" || s.edition === "VALHEIM" || s.edition === "HYTALE" || isTmodloader(s) ? TMOD_ARCH : undefined;

/** tModLoader's app on Steam, whose Workshop the mods come from. */
export const TMOD_APP_ID = 1281930;
export const isWorkshopId = (s: string) => /^[0-9]{1,12}$/.test(s);
export const workshopPage = (id: string) => `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;

/** The Workshop ID in a pasted link (…filedetails/?id=2824688072) or the ID itself; null if neither. */
export function parseWorkshopInput(input: string): string | null {
  const text = input.trim();
  if (isWorkshopId(text)) return text;
  try {
    const url = new URL(text);
    const id = url.searchParams.get("id") ?? "";
    return /(^|\.)steamcommunity\.com$/.test(url.hostname) && isWorkshopId(id) ? id : null;
  } catch {
    return null;
  }
}

/** Well-known mods offered with one click, by their Workshop IDs. `with` are mods they need to run. */
export const POPULAR_TMOD_MODS = [
  { id: "2824688072", title: "Calamity Mod", with: ["2824688266"], ramGb: 4 },
  { id: "2570931073", title: "Fargo's Mutant Mod", with: [] },
  { id: "2815540735", title: "Fargo's Souls Mod", with: ["2570931073"], ramGb: 4 },
  { id: "2563309347", title: "Magic Storage", with: ["2908170107"] },
  { id: "2669644269", title: "Boss Checklist", with: [] },
  { id: "2619954303", title: "Recipe Browser", with: [] },
  { id: "2599842771", title: "AlchemistNPC Lite", with: [] },
  { id: "2687866031", title: "Census - Town NPC Checklist", with: [] },
] as const satisfies readonly { id: string; title: string; with: readonly string[]; ramGb?: number }[];

/** Names for the popular mods and the ones they bring, in case Steam doesn't answer. */
export const KNOWN_TMOD_TITLES: Record<string, string> = {
  ...Object.fromEntries(POPULAR_TMOD_MODS.map((m) => [m.id, m.title])),
  "2824688266": "Calamity Mod Music",
  "2908170107": "absoluteAquarian Utilities (SerousCommonLib)",
};
