import { KNOWN_PLUGINS, type KnownPlugin } from "./plugins";
import type { ServerKind } from "./modpacks";

// Ready-made games offered when creating a Java server: a server kind plus the
// plugins it starts with (the owner can remove them later on the Plugins
// page), and the memory it's comfortable with for a group of friends.
export const GAMES = [
  { id: "survival", kind: "vanilla", plugins: [], ramGb: 2 },
  { id: "survival-plus", kind: "vanilla", plugins: ["essentialsx", "luckperms", "coreprotect", "griefprevention"], ramGb: 3 },
  { id: "lifesteal", kind: "vanilla", plugins: ["lifestealz"], ramGb: 3 },
  { id: "skyblock", kind: "skyblock", plugins: ["level", "challenges-for-bentobox", "warps-for-bentobox"], ramGb: 2 },
  { id: "oneblock", kind: "oneblock", plugins: ["level", "challenges-for-bentobox", "warps-for-bentobox"], ramGb: 2 },
  { id: "modpack", kind: "modpack", plugins: [], ramGb: 3 },
  // The owner picks Fabric, Forge or NeoForge when creating it; Fabric unless they do.
  { id: "mods", kind: "fabric", plugins: [], ramGb: 3 },
] as const satisfies readonly { id: string; kind: ServerKind; plugins: readonly KnownPlugin[]; ramGb: number }[];

export type GameId = (typeof GAMES)[number]["id"];
export const GAME_IDS = GAMES.map((g) => g.id) as [GameId, ...GameId[]];
export const gameById = (id: GameId) => GAMES.find((g) => g.id === id)!;
export const isGameId = (g: unknown): g is GameId => GAMES.some((x) => x.id === g);

/** Names of the plugins a game starts with, e.g. for its card. */
export const gamePluginTitles = (id: GameId) => gameById(id).plugins.map((p) => KNOWN_PLUGINS[p].title);
