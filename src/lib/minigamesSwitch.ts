import type { Server } from "@prisma/client";

// An owner of an ordinary Paper server can turn Minigames on from the panel
// and go back later. Turning them on keeps the world played until then in the
// server's files (Worlds) and remembers what the server ran; going back puts
// it all back as it was, and the minigames world stays too, so turning them on
// again goes back to it. Mod servers change type on the type page instead:
// their mods would have to move aside and back.

/** Kinds that can turn Minigames on: Paper without mods. */
export const MINIGAMES_FROM = ["vanilla", "skymap", "halloween", "skyblock", "oneblock"];

/** What the server ran before Minigames. */
export type MinigamesBack = {
  kind: string;
  version: string;
  level: string;
  levelSeed: string | null;
  levelType: string | null;
  plugins: string[];
  onlineMode: boolean;
};

export function minigamesBack(server: Pick<Server, "minigamesBack">): MinigamesBack | null {
  const b = server.minigamesBack as Partial<MinigamesBack> | null;
  if (!b || typeof b.kind !== "string" || !MINIGAMES_FROM.includes(b.kind) || typeof b.version !== "string" || typeof b.level !== "string") return null;
  return {
    kind: b.kind,
    version: b.version,
    level: b.level,
    levelSeed: typeof b.levelSeed === "string" ? b.levelSeed : null,
    levelType: typeof b.levelType === "string" ? b.levelType : null,
    plugins: Array.isArray(b.plugins) ? b.plugins.filter((p): p is string => typeof p === "string") : [],
    onlineMode: b.onlineMode !== false,
  };
}

/** Whether the panel offers the Minigames page: to turn them on, or to go back. */
export const offersMinigames = (server: Pick<Server, "edition" | "kind" | "minigamesBack">) =>
  server.edition === "JAVA" && (MINIGAMES_FROM.includes(server.kind) || (server.kind === "minigames" && minigamesBack(server) !== null));
