import type { Edition, Server } from "@prisma/client";

// Worlds are folders in a server's files (see agent/worlds.go); Server.level
// says which one the server runs, and levelSeed and levelType how a new one
// is made the first time it starts.

export const JAVA_WORLD_TYPES = ["normal", "flat", "large_biomes", "amplified"] as const;
export const BEDROCK_WORLD_TYPES = ["normal", "flat"] as const;
export type WorldType = (typeof JAVA_WORLD_TYPES)[number];

export const worldTypes = (edition: Edition): readonly WorldType[] => (edition === "JAVA" ? JAVA_WORLD_TYPES : BEDROCK_WORLD_TYPES);

/** The world a server runs when none was picked: the images' own default. */
export const defaultLevel = (edition: Edition) => (edition === "BEDROCK" ? "Bedrock level" : "world");

export const activeLevel = (s: Pick<Server, "edition" | "level">) => s.level ?? defaultLevel(s.edition);

/** Names owners give worlds: letters, digits, spaces, - and _, up to 32 characters. */
export const isValidWorldName = (name: string) => /^[\p{L}\p{N}_-][\p{L}\p{N} _-]{0,31}$/u.test(name);

/** Any name a world already has on the server, including uploads named by their file. */
export const isKnownWorldName = (name: string) => /^[\p{L}\p{N}_-][\p{L}\p{N} _.()-]{0,63}$/u.test(name);

export const isValidSeed = (seed: string) => /^[\p{L}\p{N} _-]{0,32}$/u.test(seed);

/** A world name from an uploaded file's name: "Moja Mapa (1).zip" -> "Moja Mapa 1". */
export function worldNameFromFile(file: string) {
  const name = file
    .replace(/\.(zip|mcworld)$/i, "")
    .replace(/[^\p{L}\p{N} _-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32)
    .trim();
  return isValidWorldName(name) ? name : "";
}

/** The first of world-2, world-3, ... that isn't taken. */
export function nextWorldName(taken: Iterable<string>) {
  const names = new Set([...taken].map((n) => n.toLowerCase()));
  for (let i = 2; ; i++) if (!names.has(`world-${i}`)) return `world-${i}`;
}

/** A random seed, written as Minecraft shows seeds. */
export function randomSeed() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return BigInt.asIntN(64, BigInt("0x" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""))).toString();
}

/** Folders a Java world takes: Paper keeps the nether and end beside it. */
export const javaWorldFolders = (name: string) => [name, `${name}_nether`, `${name}_the_end`];

/** Where world uploads land, one zip each, before they're unpacked into a world. */
export const WORLD_UPLOAD_DIR = ".world-uploads";
