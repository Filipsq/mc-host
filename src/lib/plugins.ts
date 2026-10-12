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
