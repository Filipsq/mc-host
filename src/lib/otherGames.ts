import type { Edition, Plan, Server } from "@prisma/client";

// Valheim and Hytale: games other than Minecraft and Terraria, each on its own
// container image (agent/valheim.go, agent/hytale.go). Both are for paid plans
// only and run on x86 machines: Valheim's server is x86 only, and Hytale's
// downloader too. Players join by the machine's address and the server's port,
// over UDP. The panel has no worlds, plugins or mods pages for them; owners
// change their files (Valheim's adminlist.txt, Hytale's config.json and mods/)
// in the file manager.

export const OTHER_GAMES = ["VALHEIM", "HYTALE"] as const satisfies readonly Edition[];
export type OtherGame = (typeof OTHER_GAMES)[number];

export const isOtherGame = (e: Edition): e is OtherGame => (OTHER_GAMES as readonly Edition[]).includes(e);
export const isValheim = (s: Pick<Server, "edition">) => s.edition === "VALHEIM";
export const isHytale = (s: Pick<Server, "edition">) => s.edition === "HYTALE";

/** Minecraft (Java or Bedrock): worlds, whitelist, game modes and the rest of the Minecraft settings. */
export const isMinecraft = (e: Edition) => e === "JAVA" || e === "BEDROCK";

/**
 * The smallest plan each game runs on. Valheim wants 2-4 GB; Hytale says 4 GB
 * at least (support.hytale.com), more than Starter's 3.
 */
export const OTHER_GAME_MIN_PLAN: Record<OtherGame, Plan> = { VALHEIM: "STARTER", HYTALE: "STANDARD" };

/** The processor every one of these games needs. */
export const OTHER_GAME_ARCH = "amd64";

// Valheim: the world's difficulty is one of the game's presets, picked any
// time (it applies on the next start). Players type the password to join;
// Valheim insists on one of at least 5 characters that isn't part of the
// server's name.
export const VALHEIM_PRESETS = ["normal", "casual", "easy", "hard", "hardcore", "immersive", "hammer"] as const;
export type ValheimPreset = (typeof VALHEIM_PRESETS)[number];
export const isValheimPreset = (p: unknown): p is ValheimPreset => VALHEIM_PRESETS.includes(p as ValheimPreset);
export const VALHEIM_PASSWORD = /^[A-Za-z0-9]{5,20}$/;
export const VALHEIM_PASSWORD_MAX = 20;

/** Whether Valheim takes this password for a server of this name. */
export const valheimPasswordOk = (password: string, name: string) =>
  VALHEIM_PASSWORD.test(password) && !name.toLowerCase().includes(password.toLowerCase());

/** A password to start with: Valheim needs one, and owners may change it in Settings. */
export function newValheimPassword() {
  const digits = "23456789";
  const letters = "abcdefghjkmnpqrstuvwxyz";
  let out = "";
  for (let i = 0; i < 4; i++) out += letters[Math.floor(Math.random() * letters.length)];
  for (let i = 0; i < 4; i++) out += digits[Math.floor(Math.random() * digits.length)];
  return out;
}

// Hytale: players may need a password too (none if empty).
export const HYTALE_PASSWORD = /^[\x21-\x7e]{1,32}$/;
export const HYTALE_PASSWORD_MAX = 32;
