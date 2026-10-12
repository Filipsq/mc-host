import type { Plan } from "@prisma/client";

// What a Java server runs. Skyblock and OneBlock are BentoBox game modes on
// Paper; a mod pack comes from Modrinth. The agent turns these into the
// image's settings (agent/main.go).
export const SERVER_KINDS = ["vanilla", "skyblock", "oneblock", "modpack"] as const;
export type ServerKind = (typeof SERVER_KINDS)[number];

export const isServerKind = (k: unknown): k is ServerKind => SERVER_KINDS.includes(k as ServerKind);

/** The command players type to get their island (shown in the panel). */
export const ISLAND_COMMAND: Partial<Record<ServerKind, string>> = { skyblock: "/island", oneblock: "/ob" };

// Mod packs offered in the panel: popular on Modrinth, made for multiplayer
// and openly licensed. Any other pack can be pasted as a Modrinth link.
// minPlan is the smallest plan with enough memory for a few players.
export const CURATED_PACKS = [
  { slug: "vanilla-perfected", title: "Vanilla Perfected", minPlan: "STARTER" },
  { slug: "cobblemon-fabric", title: "Cobblemon", minPlan: "STARTER" },
  { slug: "create_plus", title: "Create+", minPlan: "STANDARD" },
] as const satisfies readonly { slug: string; title: string; minPlan: Plan }[];

export type CuratedSlug = (typeof CURATED_PACKS)[number]["slug"];

/** Mod packs need a paid plan: free servers have too little memory and sleep. */
export const MODPACK_MIN_PLAN: Plan = "STARTER";

const PLAN_ORDER: Plan[] = ["FREE", "STARTER", "STANDARD", "PRO"];
export const planAtLeast = (plan: Plan, min: Plan) => PLAN_ORDER.indexOf(plan) >= PLAN_ORDER.indexOf(min);

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

export const LOADER_NAMES: Record<string, string> = { fabric: "Fabric", forge: "Forge", neoforge: "NeoForge", quilt: "Quilt" };

/** Where players download the exact pack version the server runs. */
export const modpackPage = (slug: string, versionId?: string | null) =>
  `https://modrinth.com/modpack/${slug}${versionId ? `/version/${versionId}` : ""}`;
