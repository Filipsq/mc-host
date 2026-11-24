import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { Server } from "@prisma/client";
import { db } from "./db";
import { listFiles, openFile, openFilesZip } from "./agent";
import { USER_AGENT } from "./modrinth";
import { isModLoader } from "./modpacks";
import { readZipText, zipStream, type ZipSource } from "./zip";

// "Mody dla graczy": the mods a mod server runs, as one file players import
// into their launcher. Minecraft can't send mods to players when they join
// (a resource pack only carries textures and sounds), so this is the next best.
//
// The panel reads the jars in the server's mods folder, finds each on Modrinth
// by its SHA-512 and builds a .mrpack (Modrinth's pack format, which Modrinth
// App, Prism Launcher and ATLauncher import): mods found on Modrinth are
// linked, the rest are packed in as files. Mods only the server needs
// (Modrinth says players can't use them, or the jar says it's server-only)
// are left out. A ZIP of the same jars is for launchers without .mrpack.
//
// Hashing reads every jar from the agent, so each jar's result is kept on the
// server row (playerModsHashes) by name, size and date, and only new or
// changed jars are read again.

const API = () => process.env.MODRINTH_API_URL ?? "https://api.modrinth.com";

/** Servers that run mods: a mod pack, or Fabric/Forge/NeoForge with the owner's mods. */
export const hasPlayerMods = (s: Pick<Server, "edition" | "kind">) => s.edition === "JAVA" && (s.kind === "modpack" || isModLoader(s.kind));

/** Players may download it while the server is paid for (or free); not before the first payment or while suspended. */
export const playerModsOpen = (s: Pick<Server, "status">) => s.status !== "AWAITING_PAYMENT" && s.status !== "SUSPENDED";

/** A new address for the players' link; the old one stops working. */
export const newPlayerModsToken = () => randomBytes(12).toString("base64url");

// A bigger jar isn't a mod anyone needs in a launcher pack; the whole pack's packed-in files are capped too.
const JAR_MAX_BYTES = 200 * 1024 * 1024;
const PACKED_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const MODS_MAX = 1000;

type Side = "server" | "client" | null;
type JarInfo = { size: number; modified: string; sha1: string; sha512: string; side: Side; modName?: string };
type HashCache = Record<string, JarInfo>;

export type PlayerMod = {
  file: string;
  title: string;
  size: number;
  sha1: string;
  sha512: string;
  /** Modrinth's download, when Modrinth has this exact file; otherwise the pack carries the jar. */
  url?: string;
  page?: string;
};

export type PlayerPack = {
  loader: "fabric" | "forge" | "neoforge" | "quilt";
  loaderVersion?: string;
  mc?: string;
  mods: PlayerMod[];
  /** Left out: only the server needs them. */
  skipped: PlayerMod[];
  /** Jars too big to read; packed into the ZIP only. */
  unread: string[];
  /** Whether Modrinth answered (if not, every mod is packed in as a file). */
  modrinth: boolean;
};

export const LOADER_KEYS = { fabric: "fabric-loader", quilt: "quilt-loader", forge: "forge", neoforge: "neoforge" } as const;

/** Which loader the server runs. */
export function loaderOf(s: Pick<Server, "kind" | "modpackLoader">): PlayerPack["loader"] {
  const k = s.kind === "modpack" ? s.modpackLoader : s.kind;
  return k === "forge" || k === "neoforge" || k === "quilt" ? k : "fabric";
}

/** What a jar says about itself: Fabric/Quilt "environment", or Forge's displayTest. */
export function jarSide(jar: Buffer): { side: Side; name?: string } {
  const fabric = readZipText(jar, "fabric.mod.json");
  if (fabric) {
    const env = /"environment"\s*:\s*"([^"]+)"/.exec(fabric)?.[1];
    const name = /"name"\s*:\s*"([^"]+)"/.exec(fabric)?.[1];
    return { side: env === "server" ? "server" : env === "client" ? "client" : null, name };
  }
  const quilt = readZipText(jar, "quilt.mod.json");
  if (quilt) {
    const env = /"environment"\s*:\s*"([^"]+)"/.exec(quilt)?.[1];
    const name = /"name"\s*:\s*"([^"]+)"/.exec(quilt)?.[1];
    return { side: env === "dedicated_server" ? "server" : env === "client" ? "client" : null, name };
  }
  const toml = readZipText(jar, "META-INF/neoforge.mods.toml") ?? readZipText(jar, "META-INF/mods.toml");
  if (toml) {
    const name = /^\s*displayName\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
    // IGNORE_SERVER_VERSION: players don't need it; clientSideOnly: only players do.
    if (/displayTest\s*=\s*"IGNORE_SERVER_VERSION"/.test(toml)) return { side: "server", name };
    if (/clientSideOnly\s*=\s*true/.test(toml)) return { side: "client", name };
    return { side: null, name };
  }
  return { side: null };
}

// "0.16.9" > "0.16.10"? No: compares number by number.
function compareVersions(a: string, b: string) {
  const pa = a.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}
const newest = (list: string[]) => [...list].sort(compareVersions).at(-1);

async function dirsIn(id: string, path: string) {
  const listing = await listFiles(id, path).catch(() => null);
  return listing?.entries.filter((e) => e.type === "dir").map((e) => e.name) ?? [];
}

/** The loader's version and Minecraft's, read from what the server installed. */
export async function detectVersions(server: Pick<Server, "id" | "kind" | "modpackLoader" | "version">) {
  const loader = loaderOf(server);
  let mc = server.version !== "LATEST" && /^\d+\.\d+(\.\d+)?$/.test(server.version) ? server.version : undefined;
  let loaderVersion: string | undefined;
  if (loader === "fabric") {
    const top = await listFiles(server.id, ".").catch(() => null);
    for (const e of top?.entries ?? []) {
      const m = /^fabric-server-mc\.([\d.]+)-loader\.([\d.]+)-launcher/.exec(e.name);
      if (m) {
        mc ??= m[1];
        loaderVersion = m[2];
      }
    }
    loaderVersion ??= newest(await dirsIn(server.id, "libraries/net/fabricmc/fabric-loader"));
    loaderVersion ??= await latestFabricLoader();
  } else if (loader === "quilt") {
    loaderVersion = newest(await dirsIn(server.id, "libraries/org/quiltmc/quilt-loader"));
  } else if (loader === "forge") {
    // libraries/net/minecraftforge/forge/1.20.1-47.3.0
    const dir = newest(await dirsIn(server.id, "libraries/net/minecraftforge/forge"));
    const m = dir && /^([\d.]+)-(.+)$/.exec(dir);
    if (m) {
      mc ??= m[1];
      loaderVersion = m[2];
    }
  } else {
    // libraries/net/neoforged/neoforge/21.1.77: Minecraft 1.21.1
    loaderVersion = newest(await dirsIn(server.id, "libraries/net/neoforged/neoforge"));
    const m = loaderVersion && /^(\d+)\.(\d+)\./.exec(loaderVersion);
    if (m && !mc) mc = Number(m[1]) >= 26 ? `${m[1]}.${m[2]}` : `1.${m[1]}${m[2] === "0" ? "" : `.${m[2]}`}`;
  }
  if (!mc) {
    const server_ = newest(await dirsIn(server.id, "libraries/net/minecraft/server"));
    mc = server_?.replace(/-.*$/, "");
  }
  return { loader, loaderVersion, mc };
}

async function latestFabricLoader() {
  try {
    const res = await fetch("https://meta.fabricmc.net/v2/versions/loader", {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(5000),
      next: { revalidate: 3600 },
    });
    const list = (await res.json()) as { version: string; stable: boolean }[];
    return list.find((l) => l.stable)?.version;
  } catch {
    return undefined;
  }
}

async function readJar(id: string, name: string): Promise<Buffer> {
  const res = await openFile(id, `mods/${name}`, { max: JAR_MAX_BYTES, signal: AbortSignal.timeout(120_000) });
  return Buffer.from(await res.arrayBuffer());
}

/** Runs fn over items, a few at a time. */
async function eachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }),
  );
}

type ModrinthFile = { hashes: { sha1: string; sha512: string }; url: string; filename: string; size: number };
type ModrinthVersion = { project_id: string; game_versions: string[]; files: ModrinthFile[] };
type ModrinthProject = { id: string; slug: string; title: string; project_type: string; client_side: string; server_side: string };

async function modrinthPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(API() + path, {
    method: "POST",
    headers: { "User-Agent": USER_AGENT, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Modrinth answered ${res.status} for ${path}`);
  return res.json() as Promise<T>;
}

async function modrinthGet<T>(path: string): Promise<T> {
  const res = await fetch(API() + path, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`Modrinth answered ${res.status} for ${path}`);
  return res.json() as Promise<T>;
}

/** Each hash's Modrinth file and project (missing: not on Modrinth). */
async function lookUp(hashes: string[]) {
  const found = new Map<string, { file: ModrinthFile; project: ModrinthProject; games: string[] }>();
  const versions = new Map<string, ModrinthVersion>();
  for (let i = 0; i < hashes.length; i += 200) {
    const part = await modrinthPost<Record<string, ModrinthVersion>>("/v2/version_files", { hashes: hashes.slice(i, i + 200), algorithm: "sha512" });
    for (const [hash, v] of Object.entries(part)) versions.set(hash, v);
  }
  const ids = [...new Set([...versions.values()].map((v) => v.project_id))];
  const projects = new Map<string, ModrinthProject>();
  for (let i = 0; i < ids.length; i += 100) {
    const part = await modrinthGet<ModrinthProject[]>(`/v2/projects?ids=${encodeURIComponent(JSON.stringify(ids.slice(i, i + 100)))}`);
    for (const p of part) projects.set(p.id, p);
  }
  for (const [hash, v] of versions) {
    const file = v.files.find((f) => f.hashes.sha512 === hash);
    const project = projects.get(v.project_id);
    if (file && project) found.set(hash, { file, project, games: v.game_versions });
  }
  return found;
}

// .mrpack downloads may only come from these hosts (Modrinth's pack format rules).
const ALLOWED_DOWNLOAD = /^https:\/\/(cdn\.modrinth\.com|github\.com|raw\.githubusercontent\.com|gitlab\.com)\//;

const titleFromFile = (file: string) => file.replace(/\.jar$/i, "").replace(/[-_+](mc)?\d[\w.+-]*$/i, "").replace(/[-_]+/g, " ").trim() || file;

const building = new Map<string, Promise<PlayerPack>>();
const built = new Map<string, { key: string; at: number; pack: PlayerPack }>();
const BUILT_FOR_MS = 10 * 60_000;

/** What goes into the players' pack. Reads new jars from the server, so the first time takes a while. */
export function playerPack(server: Server): Promise<PlayerPack> {
  const running = building.get(server.id);
  if (running) return running;
  const job = buildPack(server).finally(() => building.delete(server.id));
  building.set(server.id, job);
  return job;
}

async function buildPack(server: Server): Promise<PlayerPack> {
  const listing = await listFiles(server.id, "mods");
  const jars = listing.entries.filter((e) => e.type === "file" && e.name.toLowerCase().endsWith(".jar")).slice(0, MODS_MAX);
  const key = jars.map((j) => `${j.name}|${j.size}|${j.modified}`).join("\n");
  const ready = built.get(server.id);
  if (ready && ready.key === key && Date.now() - ready.at < BUILT_FOR_MS) return ready.pack;

  const fresh = await db.server.findUnique({ where: { id: server.id }, select: { playerModsHashes: true } });
  const old = (fresh?.playerModsHashes ?? {}) as HashCache;
  const cache: HashCache = {};
  const unread: string[] = [];
  const toRead = [];
  for (const j of jars) {
    const had = old[j.name];
    if (had && had.size === j.size && had.modified === j.modified) cache[j.name] = had;
    else if (j.size > JAR_MAX_BYTES) unread.push(j.name);
    else toRead.push(j);
  }
  await eachLimited(toRead, 4, async (j) => {
    const jar = await readJar(server.id, j.name).catch(() => null);
    if (!jar) {
      unread.push(j.name);
      return;
    }
    const { side, name } = jarSide(jar);
    cache[j.name] = {
      size: j.size,
      modified: j.modified,
      sha1: createHash("sha1").update(jar).digest("hex"),
      sha512: createHash("sha512").update(jar).digest("hex"),
      side,
      ...(name && { modName: name.slice(0, 100) }),
    };
  });
  if (toRead.length || Object.keys(old).length !== Object.keys(cache).length) {
    await db.server.update({ where: { id: server.id }, data: { playerModsHashes: cache } }).catch(() => {});
  }

  const { loader, loaderVersion, mc } = await detectVersions(server);
  let found: Awaited<ReturnType<typeof lookUp>> = new Map();
  let modrinth = true;
  try {
    found = await lookUp(Object.values(cache).map((c) => c.sha512));
  } catch (err) {
    console.error("players' mod pack: Modrinth lookup failed", err);
    modrinth = false;
  }

  const mods: PlayerMod[] = [];
  const skipped: PlayerMod[] = [];
  for (const [file, info] of Object.entries(cache)) {
    const hit = found.get(info.sha512);
    const mod: PlayerMod = {
      file,
      title: hit?.project.title ?? info.modName ?? titleFromFile(file),
      size: info.size,
      sha1: info.sha1,
      sha512: info.sha512,
      ...(hit && ALLOWED_DOWNLOAD.test(hit.file.url) && { url: hit.file.url }),
      ...(hit && { page: `https://modrinth.com/mod/${hit.project.slug}` }),
    };
    // Modrinth's word wins over the jar's; a client-only mod on the server is still the players' to have.
    const serverOnly = hit ? hit.project.client_side === "unsupported" : info.side === "server";
    (serverOnly ? skipped : mods).push(mod);
  }
  const byTitle = (a: PlayerMod, b: PlayerMod) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  mods.sort(byTitle);
  skipped.sort(byTitle);
  // Without a Minecraft version from the server, the one most of the mods were made for.
  let gameVersion = mc;
  if (!gameVersion) {
    const counts = new Map<string, number>();
    for (const h of found.values()) for (const g of h.games) counts.set(g, (counts.get(g) ?? 0) + 1);
    gameVersion = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  }
  const pack: PlayerPack = { loader, loaderVersion, mc: gameVersion, mods, skipped, unread: unread.sort(), modrinth };
  built.set(server.id, { key, at: Date.now(), pack });
  return pack;
}

/** A file name for the download, from the server's name. */
export function packFileName(server: Pick<Server, "name">, ext: "mrpack" | "zip") {
  const base = server.name.trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 60) || "mody";
  return `${base} - mody.${ext}`;
}

/** Whether a .mrpack can be made: launchers need the loader's and Minecraft's versions. */
export const canMakeMrpack = (pack: PlayerPack) => !!pack.mc && !!pack.loaderVersion;

/** The .mrpack: Modrinth's mods by link, the rest packed in under overrides/mods. */
export function mrpackStream(server: Pick<Server, "id" | "name" | "modpackTitle" | "modpackVersion">, pack: PlayerPack): ReadableStream<Uint8Array> {
  const linked = pack.mods.filter((m) => m.url);
  const packed = pack.mods.filter((m) => !m.url);
  let total = 0;
  for (const m of packed) total += m.size;
  if (total > PACKED_MAX_BYTES) throw new Error("pack too big");
  const index = {
    formatVersion: 1,
    game: "minecraft",
    versionId: server.modpackVersion ?? "1",
    name: server.name.trim() || "mchosting.pl",
    summary: server.modpackTitle ? `${server.modpackTitle} · mchosting.pl` : "mchosting.pl",
    files: linked.map((m) => ({
      path: `mods/${m.file}`,
      hashes: { sha1: m.sha1, sha512: m.sha512 },
      env: { client: "required", server: "required" },
      downloads: [m.url!],
      fileSize: m.size,
    })),
    dependencies: { minecraft: pack.mc!, [LOADER_KEYS[pack.loader]]: pack.loaderVersion! },
  };
  const files: ZipSource[] = [
    { name: "modrinth.index.json", data: Buffer.from(JSON.stringify(index, null, 2)) },
    ...packed.map((m) => ({
      name: `overrides/mods/${m.file}`,
      data: async () => {
        const res = await openFile(server.id, `mods/${m.file}`, { signal: AbortSignal.timeout(10 * 60_000) });
        if (!res.body) throw new Error("no body");
        return res.body;
      },
    })),
  ];
  return zipStream(files);
}

/** The ZIP: a mods folder with every jar players need, straight from the server. */
export async function zipOfMods(id: string, pack: PlayerPack, signal: AbortSignal) {
  const paths = [...pack.mods.map((m) => m.file), ...pack.unread].map((f) => `mods/${f}`);
  return openFilesZip(id, paths, signal);
}

const attachment = (file: string) =>
  `attachment; filename="${file.replace(/[^\w.-]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(file)}`;

/** The download for the panel's buttons and the players' link: "mrpack", "zip", or "list" (what's in it, as JSON). */
export async function playerModsResponse(server: Server, what: string | null, signal: AbortSignal): Promise<Response> {
  let pack: PlayerPack;
  try {
    pack = await playerPack(server);
  } catch (err) {
    console.error("players' mod pack failed", err);
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
  const headers = (type: string, file: string) => ({
    "Content-Type": type,
    "Content-Disposition": attachment(file),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (what === "list") {
    return Response.json(
      {
        loader: pack.loader,
        loaderVersion: pack.loaderVersion ?? null,
        mc: pack.mc ?? null,
        mrpack: canMakeMrpack(pack),
        mods: pack.mods.map((m) => ({ title: m.title, file: m.file, page: m.page ?? null, linked: !!m.url })),
        skipped: pack.skipped.map((m) => ({ title: m.title, file: m.file, page: m.page ?? null })),
        unread: pack.unread,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
  if (pack.mods.length + pack.unread.length === 0) return Response.json({ error: "empty" }, { status: 404 });
  if (what === "zip") {
    try {
      const upstream = await zipOfMods(server.id, pack, signal);
      return new Response(upstream.body, { headers: headers("application/zip", packFileName(server, "zip")) });
    } catch (err) {
      console.error("players' mod zip failed", err);
      return Response.json({ error: "unavailable" }, { status: 503 });
    }
  }
  if (!canMakeMrpack(pack)) return Response.json({ error: "noMrpack" }, { status: 409 });
  try {
    return new Response(mrpackStream(server, pack), { headers: headers("application/x-modrinth-modpack+zip", packFileName(server, "mrpack")) });
  } catch {
    return Response.json({ error: "tooBig" }, { status: 413 });
  }
}
