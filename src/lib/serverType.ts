import type { Plan, Server } from "@prisma/client";
import type { Messages } from "@/i18n/messages";
import { CURATED_PACKS, LOADER_NAMES, MODPACK_MIN_PLAN, isModLoader, planForRam } from "./modpacks";
import { gameById } from "./games";

// Changing what a Java server runs, on its type page: Paper, classic Skyblock, a BentoBox game
// mode, mods on a loader, or a mod pack. The server then starts on a new
// world, and the old one stays in its Worlds.

export const SERVER_TYPES = ["vanilla", "skymap", "skyblock", "oneblock", "mods", "modpack"] as const;
export type ServerType = (typeof SERVER_TYPES)[number];
export const isServerType = (t: unknown): t is ServerType => SERVER_TYPES.includes(t as ServerType);

/** The type a server's kind belongs to: every mod loader is "mods". */
export const typeOfKind = (kind: string): ServerType => (isModLoader(kind) ? "mods" : isServerType(kind) ? kind : "vanilla");

/** The ready game that stands for each type, for its name, description and memory. */
export const typeGame = (type: ServerType) => gameById(type === "vanilla" ? "survival" : type);

/** The smallest plan a type runs on: only mod packs need one, by the pack's memory. */
export function minPlanFor(type: ServerType, pack?: string): Plan {
  if (type !== "modpack") return "FREE";
  const curated = CURATED_PACKS.find((p) => p.slug === pack);
  return curated ? planForRam(curated.ramGb) : MODPACK_MIN_PLAN;
}

/** Memory a type is comfortable with: the pack's own need, or its ready game's. */
export function ramFor(type: ServerType, pack?: string) {
  return CURATED_PACKS.find((p) => type === "modpack" && p.slug === pack)?.ramGb ?? typeGame(type).ramGb;
}

/** Kinds whose servers keep their mods in the mods folder. */
export const usesMods = (kind: string) => kind === "modpack" || isModLoader(kind);

/** What a Java server runs, for the panel: "NeoForge · 1.21.1", "Z modami: Cobblemon". */
export function kindLabel(server: Pick<Server, "kind" | "version" | "modpack" | "modpackTitle">, t: Messages) {
  const version = server.version === "LATEST" ? t.settings.latest : server.version;
  if (isModLoader(server.kind)) return `${LOADER_NAMES[server.kind]} · ${version}`;
  if (server.kind === "modpack") return `${t.server.kinds.modpack}: ${server.modpackTitle ?? server.modpack ?? ""}`;
  if (server.kind === "skyblock" || server.kind === "oneblock") return t.server.kinds[server.kind];
  if (server.kind === "skymap" || server.kind === "halloween") return `${t.server.kinds[server.kind]} · ${version}`;
  return `${t.server.kinds.vanilla} · ${version}`;
}
