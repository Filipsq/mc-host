import type { Plan } from "@prisma/client";
import { plans } from "./plans";

// What a Java server runs. Skyblock and OneBlock are BentoBox game modes on
// Paper; a mod pack comes from Modrinth or CurseForge; a mod loader runs the mods its owner
// picks one by one. The agent turns these into the image's settings (agent/main.go).
export const MOD_LOADERS = ["fabric", "forge", "neoforge"] as const;
export type ModLoader = (typeof MOD_LOADERS)[number];
export const isModLoader = (k: unknown): k is ModLoader => MOD_LOADERS.includes(k as ModLoader);

export const SERVER_KINDS = ["vanilla", "skyblock", "oneblock", "modpack", ...MOD_LOADERS] as const;
export type ServerKind = (typeof SERVER_KINDS)[number];

export const isServerKind = (k: unknown): k is ServerKind => SERVER_KINDS.includes(k as ServerKind);

/** The command players type to get their island (shown in the panel). */
export const ISLAND_COMMAND: Partial<Record<ServerKind, string>> = { skyblock: "/island", oneblock: "/ob" };

// Mod packs offered in the panel: popular on Modrinth and made for
// multiplayer. Any other pack can be pasted as a Modrinth link. ramGb is
// what the pack needs for a few players (from its authors where they say),
// so the smallest plan it runs on is the first with that much memory.
export const CURATED_PACKS = [
  { slug: "vanilla-perfected", title: "Vanilla Perfected", ramGb: 3 },
  { slug: "cobblemon-fabric", title: "Cobblemon", ramGb: 3 },
  { slug: "cobbleverse", title: "COBBLEVERSE", ramGb: 6 },
  { slug: "create_plus", title: "Create+", ramGb: 6 },
  { slug: "homestead", title: "Homestead", ramGb: 6 },
  { slug: "better-mc-fabric-bmc2", title: "Better MC [Fabric]", ramGb: 8 },
  { slug: "prominence-2-fabric", title: "Prominence II", ramGb: 8 },
] as const satisfies readonly { slug: string; title: string; ramGb: number }[];

export type CuratedSlug = (typeof CURATED_PACKS)[number]["slug"];

/** Mod packs need a paid plan: free servers have too little memory and sleep. */
export const MODPACK_MIN_PLAN: Plan = "STARTER";

const PLAN_ORDER: Plan[] = ["FREE", "STARTER", "STANDARD", "PRO"];
export const planAtLeast = (plan: Plan, min: Plan) => PLAN_ORDER.indexOf(plan) >= PLAN_ORDER.indexOf(min);

/** The smallest paid plan with at least `gb` of memory (Pro when none has enough). */
export function planForRam(gb: number): Plan {
  return plans.find((p) => p.id !== "FREE" && p.ramGb >= gb)?.id ?? "PRO";
}

/**
 * Reads a pasted Modrinth link or slug, e.g. https://modrinth.com/modpack/cobblemon-fabric
 * or a version page under it. Returns null if it isn't one.
 */
export function parseModrinthLink(input: string): { slug: string; version?: string } | null {
  const s = input.trim();
  const link = s.match(/^(?:https?:\/\/)?(?:www\.)?modrinth\.com\/modpack\/([A-Za-z0-9_-]{2,64})(?:\/version\/([A-Za-z0-9._+-]{1,64}))?\/?(?:[?#].*)?$/);
  if (link) return { slug: link[1], version: link[2] };
  if (/^[A-Za-z0-9_-]{2,64}$/.test(s)) return { slug: s };
  return null;
}

/**
 * Reads a pasted CurseForge link, e.g. https://www.curseforge.com/minecraft/modpacks/rlcraft
 * or a file page under it. Returns null if it isn't one.
 */
export function parseCurseforgeLink(input: string): { slug: string; fileId?: number } | null {
  const m = input.trim().match(/^(?:https?:\/\/)?(?:www\.)?curseforge\.com\/minecraft\/modpacks\/([a-z0-9-]{2,64})(?:\/(?:files|download)\/(\d{1,12}))?\/?(?:[?#].*)?$/i);
  return m ? { slug: m[1].toLowerCase(), fileId: m[2] ? Number(m[2]) : undefined } : null;
}

export const LOADER_NAMES: Record<string, string> = { fabric: "Fabric", forge: "Forge", neoforge: "NeoForge", quilt: "Quilt" };

/** Where players download the exact pack version the server runs. */
export const modpackPage = (slug: string, versionId?: string | null, source?: string | null) =>
  source === "curseforge"
    ? `https://www.curseforge.com/minecraft/modpacks/${slug}${versionId ? `/files/${versionId}` : ""}`
    : `https://modrinth.com/modpack/${slug}${versionId ? `/version/${versionId}` : ""}`;
