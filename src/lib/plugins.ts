import type { Server } from "@prisma/client";

// Plugins come from Modrinth. The panel only keeps the list; the server's
// image downloads them when it starts (agent/main.go pluginEnv).

/** Most plugins one server may have added in the panel. */
export const PLUGINS_MAX = 50;

/** A Modrinth project ID, which is what the panel stores. */
export const isProjectId = (s: string) => /^[A-Za-z0-9]{8}$/.test(s);

/** Plugins every server of a game mode has; they can't be removed. */
export const GAME_MODE_PLUGINS: Record<string, { slug: string; title: string }[]> = {
  skyblock: [
    { slug: "bentobox", title: "BentoBox" },
    { slug: "bskyblock", title: "BSkyBlock" },
  ],
  oneblock: [
    { slug: "bentobox", title: "BentoBox" },
    { slug: "aoneblock", title: "AOneBlock" },
  ],
};

/** Plugins run on Paper: Java servers that aren't mod packs. */
export const supportsPlugins = (s: Pick<Server, "edition" | "kind">) => s.edition === "JAVA" && s.kind !== "modpack";

export const pluginPage = (slug: string) => `https://modrinth.com/plugin/${slug}`;

// Well-known plugins the panel offers in sets and ready games, by their
// Modrinth project IDs (which never change) and slugs. All run on Paper.
export const KNOWN_PLUGINS = {
  essentialsx: { id: "hXiIvTyT", title: "EssentialsX" },
  luckperms: { id: "Vebnzrzj", title: "LuckPerms" },
  coreprotect: { id: "Lu3KuzdV", title: "CoreProtect" },
  griefprevention: { id: "O4o4mKaq", title: "GriefPrevention" },
  worldedit: { id: "1u6JkXh5", title: "WorldEdit" },
  worldguard: { id: "DKY9btbd", title: "WorldGuard" },
  chunky: { id: "fALzjamp", title: "Chunky" },
  "multiverse-core": { id: "3wmN97b8", title: "Multiverse-Core" },
  "tab-was-taken": { id: "gG7VFbG0", title: "TAB" },
  lifestealz: { id: "l8Uv7FzS", title: "LifeStealZ" },
  level: { id: "OWzL9XSJ", title: "Island Level" },
  "challenges-for-bentobox": { id: "XtkUkQ7A", title: "Challenges" },
  "warps-for-bentobox": { id: "P08aFayx", title: "Warps" },
} as const satisfies Record<string, { id: string; title: string }>;

export type KnownPlugin = keyof typeof KNOWN_PLUGINS;

/** Sets of plugins added with one click on the Plugins page. */
export const PLUGIN_SETS = [
  { id: "basics", plugins: ["essentialsx", "luckperms", "coreprotect"] },
  { id: "protection", plugins: ["worldedit", "worldguard", "griefprevention"] },
  { id: "tools", plugins: ["chunky", "multiverse-core", "tab-was-taken"] },
  // BentoBox add-ons: only for island game modes.
  { id: "islands", plugins: ["level", "challenges-for-bentobox", "warps-for-bentobox"], kinds: ["skyblock", "oneblock"] },
] as const satisfies readonly { id: string; plugins: readonly KnownPlugin[]; kinds?: readonly string[] }[];

export type PluginSetId = (typeof PLUGIN_SETS)[number]["id"];

/** Whether a set fits a server of this kind. */
export const setFits = (set: (typeof PLUGIN_SETS)[number], kind: string) =>
  !("kinds" in set) || (set.kinds as readonly string[]).includes(kind);

export const pluginIds = (slugs: readonly KnownPlugin[]) => slugs.map((s) => KNOWN_PLUGINS[s].id);
