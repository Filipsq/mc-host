import "server-only";
import { inflateRawSync } from "node:zlib";
import { plans } from "./plans";
import { USER_AGENT } from "./modrinth";

// Mod packs from CurseForge (https://docs.curseforge.com/rest-api/): the most
// popular ones for the home page, and one pack pinned to an exact file for a
// server, which the server's image then installs (AUTO_CURSEFORGE in the agent).
// It all needs CF_API_KEY; without one, CurseForge packs don't show anywhere.

const API = () => process.env.CURSEFORGE_API_URL ?? "https://api.curseforge.com";
export const curseforgeEnabled = () => !!process.env.CF_API_KEY;

const MINECRAFT = 432; // CurseForge's game ID for Minecraft
const MODPACKS = 4471; // its class of mod packs
const POPULARITY = 2; // ModsSearchSortField
const RELEASE = 1; // FileReleaseType
const LOADERS = ["forge", "neoforge", "fabric", "quilt"];
const GAME_VERSION = /^\d+\.\d+(\.\d+)?$/;
const SLUG = /^[a-z0-9-]{2,64}$/;

// Packs that only change the player's own game (performance, shaders), so a server has nothing to run.
const CLIENT_PACKS = new Set(["fabulously-optimized", "immersed-with-shaders"]);

// The biggest plan's memory: packs that want more aren't offered.
const MAX_RAM_GB = Math.max(...plans.map((p) => p.ramGb));

/**
 * Memory a pack needs for a few players, guessed from how many mods it has
 * (CurseForge doesn't say): light packs 3–4 GB, big ones (over 200 mods) 8 GB or more.
 */
export function ramForMods(mods: number) {
  return mods <= 60 ? 3 : mods <= 120 ? 4 : mods <= 200 ? 6 : mods <= 300 ? 8 : mods <= 400 ? 10 : 12;
}

export type CurseforgePack = {
  id: number;
  slug: string;
  title: string;
  summary: string;
  icon?: string;
  picture?: string;
  downloads: number;
  fileId: number;
  fileName: string; // the pack version players install, e.g. "ATM10-2.40"
  gameVersion: string;
  loader: string;
  mods: number;
  ramGb: number;
};
export type CurseforgeError = "modpackNotFound" | "modpackNotForServers" | "modpackBlocked" | "modpackTooBig" | "curseforgeUnavailable";

type Mod = {
  id: number;
  slug: string;
  name: string;
  summary: string;
  downloadCount: number;
  logo?: { thumbnailUrl?: string; url?: string } | null;
  screenshots?: { thumbnailUrl?: string; url?: string }[];
  mainFileId: number;
  latestFilesIndexes?: { fileId: number; releaseType: number }[];
  allowModDistribution?: boolean | null;
  isAvailable?: boolean;
};
type File = {
  id: number;
  displayName: string;
  releaseType: number;
  fileLength: number;
  downloadUrl?: string | null;
  gameVersions: string[];
  isServerPack?: boolean;
};
type Manifest = { files?: { projectID: number; fileID: number; required?: boolean }[] };

async function call<T>(path: string, body?: unknown): Promise<T | null> {
  const res = await fetch(API() + path, {
    method: body ? "POST" : "GET",
    headers: {
      "x-api-key": process.env.CF_API_KEY ?? "",
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`CurseForge answered ${res.status} for ${path}`);
  return res.json() as Promise<T>;
}

/** Reads one file out of a zip on the web, fetching only the zip's directory and that file. */
async function readZipEntry(url: string, size: number, name: string): Promise<Buffer | null> {
  let whole: Buffer | null = null; // when the server sends everything instead of a range
  const range = async (from: number, to: number) => {
    if (!whole) {
      const res = await fetch(url, {
        // CurseForge's file server wants the API key too (since July 2026; without it every file is "not found").
        headers: { Range: `bytes=${from}-${to}`, "User-Agent": USER_AGENT, "x-api-key": process.env.CF_API_KEY ?? "" },
        signal: AbortSignal.timeout(60_000),
        cache: "no-store",
      });
      if (res.status === 206) return Buffer.from(await res.arrayBuffer());
      if (!res.ok) throw new Error(`pack download answered ${res.status}`);
      if (Number(res.headers.get("content-length") ?? size) > 300 << 20) throw new Error("pack too big to read");
      whole = Buffer.from(await res.arrayBuffer());
    }
    return whole.subarray(from, to + 1);
  };

  // The end of central directory record sits in the last few bytes (after a comment of up to 64 KB).
  const tailStart = Math.max(0, size - 70_000);
  const tail = await range(tailStart, size - 1);
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || eocd + 22 > tail.length) return null;
  const dirSize = tail.readUInt32LE(eocd + 12);
  const dirStart = tail.readUInt32LE(eocd + 16);
  if (dirStart === 0xffffffff || dirSize > 32 << 20) return null; // zip64 or absurd
  const dir = dirStart >= tailStart ? tail.subarray(dirStart - tailStart, dirStart - tailStart + dirSize) : await range(dirStart, dirStart + dirSize - 1);

  for (let at = 0; at + 46 <= dir.length && dir.readUInt32LE(at) === 0x02014b50; ) {
    const method = dir.readUInt16LE(at + 10);
    const packed = dir.readUInt32LE(at + 20);
    const nameLen = dir.readUInt16LE(at + 28);
    const skip = nameLen + dir.readUInt16LE(at + 30) + dir.readUInt16LE(at + 32);
    const local = dir.readUInt32LE(at + 42);
    if (dir.toString("utf8", at + 46, at + 46 + nameLen) === name) {
      if (packed > 16 << 20 || (method !== 0 && method !== 8)) return null;
      // The local header repeats the name with its own extra field; read generously, then exactly.
      let entry = await range(local, Math.min(size - 1, local + 30 + nameLen + 1024 + packed));
      const start = 30 + entry.readUInt16LE(26) + entry.readUInt16LE(28);
      if (entry.length < start + packed) entry = await range(local, local + start + packed - 1);
      const data = entry.subarray(start, start + packed);
      return method === 0 ? data : inflateRawSync(data, { maxOutputLength: 16 << 20 });
    }
    at += 46 + skip;
  }
  return null;
}

type Look = { mods: number; blocked: boolean };
// What's inside each pack file. Files never change, so this is kept (only these two numbers).
const looks = new Map<number, Look>();

/**
 * Counts the pack's mods and checks every one may be downloaded outside
 * CurseForge; when an author forbids it the server's image can't install the pack.
 */
async function lookInside(file: File): Promise<Look | null> {
  const known = looks.get(file.id);
  if (known) return known;
  // No download link means the pack itself may not be downloaded by others.
  if (!file.downloadUrl) return { mods: 0, blocked: true };
  // A "+" in a file name must be escaped, or the file server reads it as a space.
  const raw = await readZipEntry(file.downloadUrl.replaceAll("+", "%2B"), file.fileLength, "manifest.json");
  if (!raw) {
    console.warn("curseforge pack has no readable manifest.json", file.downloadUrl);
    return null;
  }
  const manifest = JSON.parse(raw.toString("utf8")) as Manifest;
  const ids = [...new Set((manifest.files ?? []).filter((f) => f.required !== false).map((f) => f.projectID))];
  let blocked = false;
  for (let i = 0; i < ids.length && !blocked; i += 500) {
    const res = await call<{ data: Mod[] }>("/v1/mods", { modIds: ids.slice(i, i + 500), filterPcOnly: true });
    blocked = (res?.data ?? []).some((m) => m.allowModDistribution === false);
  }
  const look = { mods: ids.length, blocked };
  if (looks.size > 500) looks.delete(looks.keys().next().value!);
  looks.set(file.id, look);
  return look;
}

// "1.21.1" > "1.20.6", "26.1" > "1.21.11"
function compareVersions(a: string, b: string) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/** The pack at its newest release (or the file given), if a server can run it on one of our plans. */
async function packOf(mod: Mod, fileId?: number): Promise<CurseforgePack | CurseforgeError> {
  if (!SLUG.test(mod.slug) || mod.isAvailable === false) return "modpackNotFound";
  if (CLIENT_PACKS.has(mod.slug)) return "modpackNotForServers";
  if (mod.allowModDistribution === false) return "modpackBlocked";
  const releases = (mod.latestFilesIndexes ?? []).filter((f) => f.releaseType === RELEASE).map((f) => f.fileId);
  const id = fileId ?? (releases.length ? Math.max(...releases) : mod.mainFileId);
  let file = (await call<{ data: File }>(`/v1/mods/${mod.id}/files/${id}`))?.data;
  // A server pack has no manifest for the image to follow; the pack it belongs to does.
  if (file?.isServerPack && !fileId) file = (await call<{ data: File }>(`/v1/mods/${mod.id}/files/${mod.mainFileId}`))?.data;
  if (!file || file.isServerPack) return "modpackNotFound";
  const gameVersion = file.gameVersions.filter((v) => GAME_VERSION.test(v)).sort(compareVersions).at(-1);
  const loader = file.gameVersions.map((v) => v.toLowerCase()).find((v) => LOADERS.includes(v));
  if (!gameVersion || !loader) return "modpackNotForServers";
  const look = await lookInside(file);
  if (!look || look.blocked) return "modpackBlocked";
  const ramGb = ramForMods(look.mods);
  if (ramGb > MAX_RAM_GB) return "modpackTooBig";
  const shot = mod.screenshots?.[0];
  return {
    id: mod.id,
    slug: mod.slug,
    title: mod.name.slice(0, 80),
    summary: mod.summary.slice(0, 200),
    icon: mod.logo?.thumbnailUrl || mod.logo?.url || undefined,
    picture: shot?.url || shot?.thumbnailUrl || undefined,
    downloads: mod.downloadCount,
    fileId: file.id,
    fileName: file.displayName.slice(0, 64),
    gameVersion,
    loader,
    mods: look.mods,
    ramGb,
  };
}

/** A pack by its slug (and maybe an exact file), for a new server or a change of type. */
export async function resolveCurseforgePack(ref: { slug: string; fileId?: number }): Promise<CurseforgePack | CurseforgeError> {
  if (!curseforgeEnabled() || !SLUG.test(ref.slug)) return "modpackNotFound";
  try {
    const params = new URLSearchParams({ gameId: String(MINECRAFT), classId: String(MODPACKS), slug: ref.slug });
    const mod = (await call<{ data: Mod[] }>(`/v1/mods/search?${params}`))?.data.find((m) => m.slug === ref.slug);
    return mod ? await packOf(mod, ref.fileId) : "modpackNotFound";
  } catch (err) {
    console.error("curseforge lookup failed", ref, err);
    return "curseforgeUnavailable";
  }
}

// The home page's list, refreshed in the background every hour and kept only in memory.
const TOP_SIZE = 10;
const TOP_TTL = 60 * 60_000;
const EMPTY_RETRY = 5 * 60_000;
let top: { at: number; packs: CurseforgePack[] } | null = null;
let refreshing: Promise<void> | null = null;

async function refreshTop() {
  const params = new URLSearchParams({
    gameId: String(MINECRAFT),
    classId: String(MODPACKS),
    sortField: String(POPULARITY),
    sortOrder: "desc",
    pageSize: "40",
  });
  const started = Date.now();
  const mods = (await call<{ data: Mod[] }>(`/v1/mods/search?${params}`))?.data ?? [];
  const packs: CurseforgePack[] = [];
  const skipped: Partial<Record<CurseforgeError, number>> = {};
  // In ranking order, a few at a time, skipping packs a server can't run here.
  for (let i = 0; i < mods.length && packs.length < TOP_SIZE; i += 4) {
    const found = await Promise.all(
      mods.slice(i, i + 4).map((m) =>
        packOf(m).catch((err) => {
          console.error("curseforge pack skipped", m.slug, (err as Error).message);
          return "curseforgeUnavailable" as const;
        }),
      ),
    );
    for (const p of found) {
      if (typeof p === "object") packs.push(p);
      else skipped[p] = (skipped[p] ?? 0) + 1;
    }
  }
  console.log(
    `curseforge top packs: ${Math.min(packs.length, TOP_SIZE)} of ${mods.length} found in ${Math.round((Date.now() - started) / 1000)}s, skipped ${JSON.stringify(skipped)}`,
  );
  // An empty list (CurseForge or its downloads failing) is tried again soon instead of in an hour.
  top = { at: packs.length ? Date.now() : Date.now() - TOP_TTL + EMPTY_RETRY, packs: packs.slice(0, TOP_SIZE) };
}

/**
 * The most popular packs on CurseForge that run on our plans, in ranking order.
 * Null until the first list is ready (it waits a moment for that) or without a key.
 */
export async function topCurseforgePacks(): Promise<CurseforgePack[] | null> {
  if (!curseforgeEnabled()) return null;
  if (!top || Date.now() - top.at > TOP_TTL) {
    refreshing ??= refreshTop()
      .catch((err) => console.error("curseforge top packs failed", err))
      .finally(() => (refreshing = null));
    if (!top) await Promise.race([refreshing, new Promise((r) => setTimeout(r, 3000))]);
  }
  return top?.packs ?? null;
}
