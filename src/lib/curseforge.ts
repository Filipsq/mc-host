import "server-only";
import { inflateRawSync } from "node:zlib";
import { plans } from "./plans";
import { USER_AGENT } from "./modrinth";

// Mod packs from CurseForge (https://docs.curseforge.com/rest-api/): the most
// popular ones for the home page, and one pack pinned to an exact file for a
// server, which the server's image then installs (AUTO_CURSEFORGE in the agent).
// It all needs CF_API_KEY; without one, CurseForge packs don't show anywhere.

const API = () => process.env.CURSEFORGE_API_URL ?? "https://api.curseforge.com";
const CDN = () => process.env.CURSEFORGE_CDN_URL ?? "https://edge.forgecdn.net";
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
  fileName?: string;
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

type Address = { url: string; part: boolean; kind: string; label: string };

// The kind of address that last worked, tried first for the next pack (they all live on the same file server).
let lastWorked: string | null = null;

/**
 * Where a pack file can be read from: the link the API gives, the file's usual
 * address built from its ID, and CurseForge's second file server; first asking
 * for just the parts needed, then for the whole file, which some file servers
 * insist on. The API key always goes along (CurseForge's file server wants it
 * since July 2026).
 */
function fileAddresses(file: File): Address[] {
  // A "+" in a file name must be escaped, or the file server reads it as a space.
  const link = file.downloadUrl!.replaceAll("+", "%2B");
  const built = file.fileName ? `${CDN()}/files/${Math.floor(file.id / 1000)}/${file.id % 1000}/${encodeURIComponent(file.fileName)}` : link;
  const mirror = link.replace("//edge.forgecdn.net/", "//mediafilez.forgecdn.net/");
  const list: Address[] = [];
  for (const part of [true, false]) {
    for (const [kind, url] of [["link", link], ["built", built], ["mirror", mirror]]) {
      if (list.some((a) => a.url === url && a.part === part)) continue;
      list.push({ url, part, kind: `${kind} ${part}`, label: `${new URL(url).host}, ${part ? "part" : "whole file"}` });
    }
  }
  return list.sort((a, b) => Number(b.kind === lastWorked) - Number(a.kind === lastWorked));
}

/**
 * Fetches part of a file (or all of it, where the address says so) from the
 * first address that answers, which it then keeps to. The error lists every
 * refusal, without the key.
 */
async function fetchPart(addresses: Address[], from: number, to: number) {
  const refused: string[] = [];
  for (const a of addresses) {
    const res = await fetch(a.url, {
      headers: {
        ...(a.part ? { Range: `bytes=${from}-${to}` } : {}),
        "User-Agent": USER_AGENT,
        "x-api-key": process.env.CF_API_KEY ?? "",
      },
      signal: AbortSignal.timeout(60_000),
      cache: "no-store",
    });
    if (res.ok) {
      addresses.splice(0, addresses.length, a);
      lastWorked = a.kind;
      return res;
    }
    // What the first refusal says (and who said it), for the log; the others only by their status.
    const said = refused.length
      ? (await res.body?.cancel(), "")
      : ` [${res.headers.get("server") ?? "?"}]: ${(await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 100)}`;
    refused.push(`${res.status} (${a.label})${said}`);
    if (res.status >= 500) break; // the file server is down: other addresses won't help
  }
  throw new Error(`pack download answered ${refused.join(", ")}`);
}

const WHOLE_MAX = 300 << 20; // the biggest pack file read whole

/**
 * Reads a whole zip as it downloads, stepping from entry to entry and stopping
 * at the one wanted (manifest.json usually comes first, so that's a few KB).
 * When the entries can't be stepped through, the whole file comes back for
 * the directory at its end to find the entry.
 */
async function scanZip(res: Response, name: string): Promise<{ entry: Buffer | null } | { whole: Buffer }> {
  const reader = res.body!.getReader();
  let buf = Buffer.alloc(1 << 20);
  let len = 0;
  const fill = async (n: number) => {
    while (len < n) {
      const { done, value } = await reader.read();
      if (done) return false;
      if (len + value.length > WHOLE_MAX) {
        await reader.cancel();
        throw new Error("pack too big to read");
      }
      if (len + value.length > buf.length) {
        const bigger = Buffer.alloc(Math.max(buf.length * 2, len + value.length));
        buf.copy(bigger, 0, 0, len);
        buf = bigger;
      }
      buf.set(value, len);
      len += value.length;
    }
    return true;
  };
  for (let at = 0; (await fill(at + 30)) && buf.readUInt32LE(at) === 0x04034b50; ) {
    const flags = buf.readUInt16LE(at + 6);
    const method = buf.readUInt16LE(at + 8);
    const packed = buf.readUInt32LE(at + 18);
    const nameLen = buf.readUInt16LE(at + 26);
    const start = at + 30 + nameLen + buf.readUInt16LE(at + 28);
    if (flags & 8 || packed === 0xffffffff || !(await fill(start))) break; // size given after the data, or zip64
    if (buf.toString("utf8", at + 30, at + 30 + nameLen) === name) {
      const ok = packed <= 16 << 20 && (method === 0 || method === 8) && (await fill(start + packed));
      await reader.cancel();
      if (!ok) return { entry: null };
      const data = Buffer.from(buf.subarray(start, start + packed));
      return { entry: method === 0 ? data : inflateRawSync(data, { maxOutputLength: 16 << 20 }) };
    }
    at = start + packed;
  }
  while (await fill(len + 1));
  return { whole: buf.subarray(0, len) };
}

/** Reads one file out of a zip on the web, fetching only the zip's directory and that file where it can. */
async function readZipEntry(addresses: Address[], size: number, name: string): Promise<Buffer | null> {
  // The end of central directory record sits in the last few bytes (after a comment of up to 64 KB).
  let tailStart = Math.max(0, size - 70_000);
  const first = await fetchPart(addresses, tailStart, size - 1);
  let whole: Buffer | null = null;
  let tail: Buffer;
  if (first.status === 206) tail = Buffer.from(await first.arrayBuffer());
  else {
    // The whole file is coming: read it as it comes, stopping at the entry if it can.
    const read = await scanZip(first, name);
    if ("entry" in read) return read.entry;
    whole = read.whole;
    size = whole.length;
    tailStart = Math.max(0, size - 70_000);
    tail = whole.subarray(tailStart);
  }
  const range = async (from: number, to: number) => {
    if (!whole) {
      const res = await fetchPart(addresses, from, to);
      if (res.status === 206) return Buffer.from(await res.arrayBuffer());
      if (Number(res.headers.get("content-length") ?? size) > WHOLE_MAX) throw new Error("pack too big to read");
      whole = Buffer.from(await res.arrayBuffer());
    }
    return whole.subarray(from, to + 1);
  };

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
  const raw = await readZipEntry(fileAddresses(file), file.fileLength, "manifest.json");
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
    // Every pack so far failed to download: the rest would too, so they aren't asked for until the next try.
    if (!packs.length && skipped.curseforgeUnavailable === i + found.length) break;
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
