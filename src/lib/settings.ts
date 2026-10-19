import type { Edition } from "@prisma/client";
import { isModLoader, type ModLoader } from "./modpacks";

// Game settings owners pick on the server's Settings page. The agent turns
// them into the server image's environment, so they apply on the next start.

export const GAME_MODES = ["survival", "creative", "adventure"] as const;
export const DIFFICULTIES = ["peaceful", "easy", "normal", "hard"] as const;
export type GameMode = (typeof GAME_MODES)[number];
export type Difficulty = (typeof DIFFICULTIES)[number];

// Paper versions a Java server can run; LATEST follows the newest release.
// The agent picks the Java each one needs.
export const JAVA_VERSIONS = [
  "LATEST",
  "1.21.11",
  "1.21.8",
  "1.21.4",
  "1.21.1",
  "1.20.6",
  "1.20.4",
  "1.20.1",
  "1.19.4",
  "1.18.2",
  "1.17.1",
];

// Versions a mod loader server can run. Most mods are made for 1.21.1, so new
// mod servers start there. Forge and NeoForge only get a version once it's out,
// so they have no LATEST, and NeoForge starts at 1.20.4.
export const LOADER_VERSIONS: Record<ModLoader, string[]> = {
  fabric: JAVA_VERSIONS,
  forge: JAVA_VERSIONS.filter((v) => v !== "LATEST"),
  neoforge: ["1.21.11", "1.21.8", "1.21.4", "1.21.1", "1.20.6", "1.20.4"],
};
export const MOD_DEFAULT_VERSION = "1.21.1";

/** Versions the owner may pick for a server of this kind (none: the game mode or pack decides). */
export function versionsFor(kind: string): string[] {
  if (kind === "vanilla") return JAVA_VERSIONS;
  return isModLoader(kind) ? LOADER_VERSIONS[kind] : [];
}

export const MOTD_MAX = 60;
export const WHITELIST_MAX = 100;

// Java profile names, or Xbox gamertags for Bedrock (letters in any script, digits, spaces).
// Terraria has no allow list here; its characters' names are up to 20 characters.
const PLAYER_NAME: Record<Edition, RegExp> = {
  JAVA: /^[A-Za-z0-9_]{3,16}$/,
  BEDROCK: /^[\p{L}\p{N}_-][\p{L}\p{N} _-]{0,31}$/u,
  TERRARIA: /^\S.{0,19}$/u,
};

export const isValidPlayerName = (edition: Edition, name: string) => PLAYER_NAME[edition].test(name);

/** One name per line (commas work too), trimmed, without repeats. */
export function parsePlayers(text: string) {
  const seen = new Set<string>();
  return text
    .split(/[\n,]/)
    .map((n) => n.trim())
    .filter((n) => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()));
}

/**
 * Whether the version is from before Minecraft's year-based versions (26.1+).
 * Those can't open a world 26.1 or newer saved at all: 26.1 moved its seed and
 * dimensions out of level.dat.
 */
export const isPreYearVersion = (v: string) => v.startsWith("1.");

function versionParts(v: string) {
  return v === "LATEST" ? [Infinity] : v.split(".").map(Number);
}

/** Whether `to` is older than `from`: a world saved by a newer version can break in an older one. */
export function isDowngrade(from: string, to: string) {
  const a = versionParts(from);
  const b = versionParts(to);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return y < x;
  }
  return false;
}
