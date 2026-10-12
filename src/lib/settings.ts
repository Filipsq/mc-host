import type { Edition } from "@prisma/client";

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

export const MOTD_MAX = 60;
export const WHITELIST_MAX = 100;

// Java profile names, or Xbox gamertags for Bedrock (letters in any script, digits, spaces).
const PLAYER_NAME: Record<Edition, RegExp> = {
  JAVA: /^[A-Za-z0-9_]{3,16}$/,
  BEDROCK: /^[\p{L}\p{N}_-][\p{L}\p{N} _-]{0,31}$/u,
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
