import type { Server } from "@prisma/client";
import { isModLoader, type ModLoader } from "./modpacks";
import { isTmodloader } from "./terraria";

// Plugins come from Modrinth. The panel only keeps the list; the server's
// image downloads them when it starts (agent/main.go pluginEnv).

/** Most plugins one server may have added in the panel. */
export const PLUGINS_MAX = 50;

/** A Modrinth project ID, which is what the panel stores. */
export const isProjectId = (s: string) => /^[A-Za-z0-9]{8}$/.test(s);

// A mod from CurseForge is stored as "cf:<project ID>:<file ID>", pinned to the
// file the panel picked for the server's Minecraft version and loader
// (src/lib/curseforge.ts pinCurseforgeMods); the agent hands those to the image.
const CF_MOD = /^cf:(\d{1,10}):(\d{1,12})$/;

/** The CurseForge project and file of a stored mod, or null for a Modrinth one. */
export function curseforgeMod(entry: string): { modId: number; fileId: number } | null {
  const m = entry.match(CF_MOD);
  return m ? { modId: Number(m[1]), fileId: Number(m[2]) } : null;
}

export const curseforgeEntry = (modId: number, fileId: number) => `cf:${modId}:${fileId}`;

/** Whether the list already has a file of this CurseForge project. */
export const hasCurseforgeMod = (plugins: string[], modId: number) => plugins.some((p) => curseforgeMod(p)?.modId === modId);

// A plugin from Hangar or SpigotMC is stored as "hangar:<slug>" or
// "spigot:<resource number>". The image can't install those, so the panel puts
// the jar in the plugins folder itself (src/lib/sitePlugins.ts) and never
// hands these entries to the agent.
export type PluginSite = "hangar" | "spigot";
const SITE_PLUGIN = /^(hangar):([A-Za-z0-9_-]{1,64})$|^(spigot):(\d{1,9})$/;

/** The site and its reference of a stored plugin, or null for a Modrinth or CurseForge one. */
export function sitePlugin(entry: string): { site: PluginSite; ref: string } | null {
  const m = entry.match(SITE_PLUGIN);
  return m ? { site: (m[1] ?? m[3]) as PluginSite, ref: m[2] ?? m[4] } : null;
}

export const sitePluginEntry = (site: PluginSite, ref: string) => `${site}:${ref}`;

/** Where the panel puts a site plugin's jar in the server's files. */
export function sitePluginFile(entry: string) {
  const p = sitePlugin(entry);
  return p && `plugins/mchost-${p.site}-${p.ref}.jar`;
}

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

/** Plugins run on Paper: plain Java servers, classic Skyblock, Halloween Survival and the island game modes. */
export const supportsPlugins = (s: Pick<Server, "edition" | "kind">) =>
  s.edition === "JAVA" && ["vanilla", "skymap", "halloween", "skyblock", "oneblock"].includes(s.kind);

/**
 * Non-premium needs a login addon, so nobody plays under someone else's name:
 * AuthMe on Paper, or a server-side login mod on a mod loader, only on the
 * Minecraft versions it's made for (newest versions and mod packs have none we
 * trust yet). The agent keeps the same list (agent/login.go loginMods).
 */
export const LOGIN_MODS: Record<ModLoader, { id: string; title: string; versions: readonly string[] }> = {
  fabric: { id: "aZj58GfX", title: "EasyAuth", versions: ["1.21.11", "1.21.8", "1.21.4", "1.21.1", "1.20.6", "1.20.4", "1.20.1", "1.19.4"] },
  forge: { id: "VYmP7iH5", title: "EasyLogin", versions: ["1.21.1"] },
  neoforge: { id: "VYmP7iH5", title: "EasyLogin", versions: ["1.21.11", "1.21.1"] },
};

export const canRunNonPremium = (s: Pick<Server, "edition" | "kind" | "version">) =>
  supportsPlugins(s) || (s.edition === "JAVA" && isModLoader(s.kind) && LOGIN_MODS[s.kind].versions.includes(s.version));

/** Bedrock players get in through the Geyser plugin, so crossplay is for Paper servers too. */
export const canCrossplay = supportsPlugins;

/** A plain Java server, which lists mods too (it can't run them; picking them leads to a switch to Fabric). */
export const offersModPicker = (s: Pick<Server, "edition" | "kind">) => s.edition === "JAVA" && s.kind === "vanilla";

/** Mods picked one by one run on a Fabric, Forge or NeoForge server (a mod pack brings its own). */
export const supportsMods = (s: Pick<Server, "edition" | "kind">) => s.edition === "JAVA" && isModLoader(s.kind);

export type AddonType = "plugin" | "mod" | "workshop";

/**
 * What the owner adds on the Plugins page: plugins or mods from Modrinth,
 * tModLoader mods from the Steam Workshop, or nothing (Bedrock, mod packs, plain Terraria).
 */
export const addonType = (s: Pick<Server, "edition" | "kind">): AddonType | null =>
  supportsPlugins(s) ? "plugin" : supportsMods(s) ? "mod" : isTmodloader(s) ? "workshop" : null;

export const pluginPage = (slug: string, type: AddonType = "plugin") => `https://modrinth.com/${type}/${slug}`;
export const curseforgeModPage = (slug: string) => `https://www.curseforge.com/minecraft/mc-mods/${slug}`;

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

/** Simple Voice Chat, the same project for Paper and the mod loaders; the agent opens its port (agent/voice.go). */
export const VOICE_CHAT = { id: "9eGKb6K1", slug: "simple-voice-chat", title: "Simple Voice Chat" } as const;

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
