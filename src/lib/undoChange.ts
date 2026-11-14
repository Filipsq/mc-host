import type { Server } from "@prisma/client";

// Changing a server's type (Paper to Fabric, a mod pack...) or its Minecraft
// version takes plugins and mods off the list, and a type change starts a new
// world. Nothing is deleted: the old world stays in Worlds, plugin settings stay
// in their folders and the old mods are moved aside. So the panel remembers
// what the server ran just before the last such change, and the owner can put
// it back with one button for UNDO_DAYS ("Cofnij zmianę"). This costs no disk:
// it's only the server's settings, plus the name of the folder its old mods
// went to. The next change replaces it; undoing clears it.

/** How long "Cofnij zmianę" is offered after a change. */
export const UNDO_DAYS = 7;

/** What the server ran before its last type or version change. */
export type UndoChange = {
  /** When the change was made (ISO). */
  at: string;
  /** What changed: the type (on the type page) or the version (in Settings or a new world in Worlds). */
  what: "type" | "version";
  kind: string;
  version: string;
  modpack: string | null;
  modpackSource: string | null;
  modpackTitle: string | null;
  modpackVersionId: string | null;
  modpackVersion: string | null;
  modpackLoader: string | null;
  plugins: string[];
  onlineMode: boolean;
  ownLogin: boolean;
  level: string;
  levelSeed: string | null;
  levelType: string | null;
  /** The folder the old type's mods were moved to (mods-fabric), to bring them back. */
  modsFolder: string | null;
};

type Snapshotted = Pick<
  Server,
  | "kind"
  | "version"
  | "modpack"
  | "modpackSource"
  | "modpackTitle"
  | "modpackVersionId"
  | "modpackVersion"
  | "modpackLoader"
  | "plugins"
  | "onlineMode"
  | "ownLogin"
  | "levelSeed"
  | "levelType"
>;

/** What to remember right before a change; `level` is the world the server plays now (activeLevel). */
export function undoSnapshot(server: Snapshotted, what: UndoChange["what"], level: string, modsFolder: string | null = null, now = new Date()): UndoChange {
  return {
    at: now.toISOString(),
    what,
    kind: server.kind,
    version: server.version,
    modpack: server.modpack,
    modpackSource: server.modpackSource,
    modpackTitle: server.modpackTitle,
    modpackVersionId: server.modpackVersionId,
    modpackVersion: server.modpackVersion,
    modpackLoader: server.modpackLoader,
    plugins: server.plugins,
    onlineMode: server.onlineMode,
    ownLogin: server.ownLogin,
    level,
    levelSeed: server.levelSeed,
    levelType: server.levelType,
    modsFolder,
  };
}

const str = (v: unknown) => (typeof v === "string" ? v : null);

/** The remembered state, or null if there's none, it's broken, or it's older than UNDO_DAYS. */
export function undoChange(server: Pick<Server, "undoChange">, now = new Date()): UndoChange | null {
  const u = server.undoChange as Partial<UndoChange> | null;
  if (!u || typeof u !== "object" || typeof u.kind !== "string" || typeof u.version !== "string" || typeof u.level !== "string") return null;
  const at = typeof u.at === "string" ? new Date(u.at) : null;
  if (!at || Number.isNaN(at.getTime()) || now.getTime() - at.getTime() > UNDO_DAYS * 86_400_000) return null;
  return {
    at: at.toISOString(),
    what: u.what === "version" ? "version" : "type",
    kind: u.kind,
    version: u.version,
    modpack: str(u.modpack),
    modpackSource: str(u.modpackSource),
    modpackTitle: str(u.modpackTitle),
    modpackVersionId: str(u.modpackVersionId),
    modpackVersion: str(u.modpackVersion),
    modpackLoader: str(u.modpackLoader),
    plugins: Array.isArray(u.plugins) ? u.plugins.filter((p): p is string => typeof p === "string") : [],
    onlineMode: u.onlineMode !== false,
    ownLogin: u.ownLogin !== false,
    level: u.level,
    levelSeed: str(u.levelSeed),
    levelType: str(u.levelType),
    modsFolder: str(u.modsFolder),
  };
}

/** The last day "Cofnij zmianę" is offered. */
export const undoUntil = (u: UndoChange) => new Date(new Date(u.at).getTime() + UNDO_DAYS * 86_400_000);

/** "mods-fabric", or "mods-fabric-2" if that's taken. */
export function freeName(taken: string[], base: string) {
  const names = new Set(taken);
  for (let i = 1; ; i++) {
    const name = i === 1 ? base : `${base}-${i}`;
    if (!names.has(name)) return name;
  }
}
