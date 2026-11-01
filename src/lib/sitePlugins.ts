import "server-only";
import { inflateRawSync } from "node:zlib";
import { USER_AGENT } from "./modrinth";
import { sitePlugin, sitePluginEntry, type PluginSite } from "./plugins";

// Plugins from Hangar (PaperMC's site, https://hangar.papermc.io/api-docs) and
// SpigotMC (through Spiget, https://spiget.org, which mirrors its free plugins).
// The server's image only installs Modrinth's by itself, so the panel
// downloads the plugin's jar when the owner adds it and puts it in the
// server's plugins folder (src/lib/plugins.ts sitePluginFile), like an upload
// in Files. It stays at the version it was added with.

const HANGAR = () => process.env.HANGAR_API_URL ?? "https://hangar.papermc.io";
const SPIGET = () => process.env.SPIGET_API_URL ?? "https://api.spiget.org";
// Where the jars come from, redirects included; nothing else is downloaded.
const DOWNLOAD_HOSTS = () =>
  (process.env.SITE_PLUGIN_HOSTS ?? "hangar.papermc.io,hangarcdn.papermc.io,api.spiget.org,cdn.spiget.org").split(",");
const MAX_JAR_BYTES = 50 * 1024 * 1024;

export type SitePluginHit = {
  entry: string; // what Server.plugins keeps
  title: string;
  description: string;
  icon?: string;
  page: string;
  downloads: number;
  /** SpigotMC: paid, or only on the author's own site; the owner has to upload it in Files. */
  blocked?: boolean;
  /** The newest Minecraft version it says it works on. */
  newestVersion?: string;
};
export type SiteError = "pluginNotFound" | "siteBlocked" | "siteNoVersion" | "siteUnavailable" | "siteBadFile";

async function get<T>(url: string, revalidate?: number): Promise<T | null> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
    ...(revalidate ? { next: { revalidate } } : { cache: "no-store" }),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status} for ${url}`);
  return res.json() as Promise<T>;
}

const RELEASE = /^\d+\.\d+(\.\d+)?$/;

// "1.21.1" > "1.20.6", "26.1" > "1.21.11"
function compareVersions(a: string, b: string) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/**
 * Whether a Minecraft version is among the ones a plugin version lists:
 * "1.21.1", a range "1.20-1.21.4" (".x" and a plain "1.21" take every patch).
 */
export function supportsVersion(listed: string[], mc: string) {
  const top = (v: string) => (v.split(".").length === 2 ? `${v}.999` : v);
  return listed.some((raw) => {
    const v = raw.trim().replace(/\.x$/i, "");
    const [from, to] = v.split("-").map((s) => s.trim());
    if (to) return RELEASE.test(from) && RELEASE.test(to) && compareVersions(mc, from) >= 0 && compareVersions(mc, top(to)) <= 0;
    if (!RELEASE.test(from)) return false;
    return from.split(".").length === 2 ? mc === from || mc.startsWith(from + ".") : mc === from;
  });
}

/** The newest release version in a list like Hangar's or SpigotMC's ("1.21.x" and ranges count by their top). */
function newest(listed: string[]) {
  return listed
    .flatMap((v) => v.split("-"))
    .map((v) => v.trim().replace(/\.x$/i, ""))
    .filter((v) => RELEASE.test(v))
    .sort(compareVersions)
    .at(-1);
}

// ---- Hangar ----

type HangarProject = {
  name: string;
  namespace: { owner: string; slug: string };
  description?: string;
  avatarUrl?: string;
  stats?: { downloads?: number };
  supportedPlatforms?: Record<string, string[]>;
};
type HangarVersion = {
  name: string;
  channel?: { name?: string };
  downloads: Record<string, { downloadUrl?: string | null; externalUrl?: string | null; fileInfo?: { sizeBytes?: number } | null }>;
  platformDependencies?: Record<string, string[]>;
};

const hangarHit = (p: HangarProject): SitePluginHit => ({
  entry: sitePluginEntry("hangar", p.namespace.slug),
  title: p.name.slice(0, 80),
  description: (p.description ?? "").slice(0, 200),
  icon: p.avatarUrl?.startsWith("https://") ? p.avatarUrl : undefined,
  page: `https://hangar.papermc.io/${encodeURIComponent(p.namespace.owner)}/${encodeURIComponent(p.namespace.slug)}`,
  downloads: p.stats?.downloads ?? 0,
  newestVersion: newest(p.supportedPlatforms?.PAPER ?? []),
});

async function searchHangar(query: string, mc?: string) {
  const params = new URLSearchParams({ limit: "20", offset: "0", platform: "PAPER" });
  // Hangar has called the search text both names.
  if (query) {
    params.set("query", query);
    params.set("q", query);
  } else params.set("sort", "-downloads");
  if (mc) params.set("version", mc);
  const res = await get<{ result: HangarProject[] }>(`${HANGAR()}/api/v1/projects?${params}`);
  return (res?.result ?? []).filter((p) => sitePlugin(sitePluginEntry("hangar", p.namespace.slug))).map(hangarHit);
}

/** The jar to download for a Hangar plugin: its newest Paper version for the server's Minecraft (releases first). */
async function hangarDownload(slug: string, mc?: string): Promise<{ url: string; title: string } | SiteError> {
  const project = await get<HangarProject>(`${HANGAR()}/api/v1/projects/${encodeURIComponent(slug)}`);
  if (!project) return "pluginNotFound";
  const params = new URLSearchParams({ limit: "25", offset: "0", platform: "PAPER" });
  const versions = (await get<{ result: HangarVersion[] }>(`${HANGAR()}/api/v1/projects/${encodeURIComponent(slug)}/versions?${params}`))?.result ?? [];
  const fits = versions.filter((v) => v.downloads.PAPER && (!mc || supportsVersion(v.platformDependencies?.PAPER ?? [], mc)));
  const version = fits.find((v) => (v.channel?.name ?? "").toLowerCase() === "release") ?? fits[0];
  if (!version) return "siteNoVersion";
  const url = version.downloads.PAPER.downloadUrl;
  // Only on the author's own site.
  if (!url) return "siteBlocked";
  return { url, title: project.name };
}

// ---- SpigotMC (Spiget) ----

type SpigetResource = {
  id: number;
  name: string;
  tag?: string;
  downloads?: number;
  premium?: boolean;
  external?: boolean;
  file?: { type?: string; externalUrl?: string };
  icon?: { url?: string };
  testedVersions?: string[];
};
const SPIGET_FIELDS = "id,name,tag,downloads,premium,external,file,icon,testedVersions";

// Spiget mirrors only free plugins kept on SpigotMC itself, as a jar.
const spigotBlocked = (r: SpigetResource) => !!r.premium || !!r.external || r.file?.type !== ".jar";

const spigotHit = (r: SpigetResource): SitePluginHit => ({
  entry: sitePluginEntry("spigot", String(r.id)),
  // Names come with HTML entities ("&amp;").
  title: decodeEntities(r.name).slice(0, 80),
  description: decodeEntities(r.tag ?? "").slice(0, 200),
  icon: r.icon?.url && /^data\/resource_icons\/[\w/]+\.(png|jpe?g|gif|webp)$/i.test(r.icon.url) ? `https://www.spigotmc.org/${r.icon.url}` : undefined,
  page: `https://www.spigotmc.org/resources/${r.id}/`,
  downloads: r.downloads ?? 0,
  blocked: spigotBlocked(r),
  newestVersion: newest(r.testedVersions ?? []),
});

function decodeEntities(s: string) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

async function searchSpigot(query: string) {
  const params = new URLSearchParams({ size: "20", sort: "-downloads", fields: SPIGET_FIELDS });
  const path = query ? `/v2/search/resources/${encodeURIComponent(query)}?field=name&${params}` : `/v2/resources/free?${params}`;
  return ((await get<SpigetResource[]>(SPIGET() + path)) ?? []).map(spigotHit);
}

async function spigotDownload(id: string): Promise<{ url: string; title: string } | SiteError> {
  const r = await get<SpigetResource>(`${SPIGET()}/v2/resources/${id}`);
  if (!r) return "pluginNotFound";
  if (spigotBlocked(r)) return "siteBlocked";
  return { url: `${SPIGET()}/v2/resources/${id}/download`, title: decodeEntities(r.name) };
}

// ---- Both ----

/** Plugins on the site matching the query (the most downloaded without one). */
export async function searchSitePlugins(site: PluginSite, query: string, mc?: string): Promise<SitePluginHit[] | "siteUnavailable"> {
  try {
    return await (site === "hangar" ? searchHangar(query.slice(0, 100), mc) : searchSpigot(query.slice(0, 100)));
  } catch (err) {
    console.error(`${site} search failed`, query, err);
    return "siteUnavailable";
  }
}

/** Names, links and icons of the server's plugins from these sites, by entry; missing ones if a site doesn't answer. */
export async function getSitePluginInfos(entries: string[]): Promise<Map<string, SitePluginHit>> {
  const found = await Promise.all(
    entries.map(async (entry) => {
      const p = sitePlugin(entry);
      if (!p) return null;
      try {
        if (p.site === "hangar") {
          const project = await get<HangarProject>(`${HANGAR()}/api/v1/projects/${encodeURIComponent(p.ref)}`, 86_400);
          return project && ([entry, hangarHit(project)] as const);
        }
        const r = await get<SpigetResource>(`${SPIGET()}/v2/resources/${p.ref}?fields=${SPIGET_FIELDS}`, 86_400);
        return r && ([entry, spigotHit(r)] as const);
      } catch (err) {
        console.error(`${p.site} lookup failed`, entry, err);
        return null;
      }
    }),
  );
  return new Map(found.filter((f) => f !== null));
}

/** A plugin from a pasted Hangar or SpigotMC link (or a SpigotMC resource number), as Server.plugins keeps it. */
export function sitePluginFromLink(input: string): string | null {
  const s = input.trim();
  const spigot = s.match(/spigotmc\.org\/resources\/(?:[^/?#]*\.)?(\d{1,9})\/?/i)?.[1] ?? s.match(/^(\d{1,9})$/)?.[1];
  if (spigot) return sitePluginEntry("spigot", spigot);
  const hangar = s.match(/hangar\.papermc\.io\/[^/?#\s]+\/([^/?#\s]+)/i)?.[1];
  const entry = hangar && sitePluginEntry("hangar", hangar);
  return entry && sitePlugin(entry) ? entry : null;
}

/**
 * Downloads a plugin's jar for a server on this Minecraft version (undefined:
 * the newest), checking that it is a Bukkit/Paper plugin.
 */
export async function downloadSitePlugin(entry: string, mc?: string): Promise<{ jar: Uint8Array<ArrayBuffer>; title: string } | { error: SiteError; name?: string }> {
  const p = sitePlugin(entry);
  if (!p) return { error: "pluginNotFound" };
  let found;
  try {
    found = p.site === "hangar" ? await hangarDownload(p.ref, mc) : await spigotDownload(p.ref);
  } catch (err) {
    console.error(`${p.site} lookup failed`, entry, err);
    return { error: "siteUnavailable" };
  }
  if (typeof found === "string") return { error: found };
  let jar;
  try {
    jar = await fetchJar(found.url);
  } catch (err) {
    console.error(`${p.site} download failed`, entry, err);
    return { error: "siteUnavailable", name: found.title };
  }
  if (!jar) return { error: "siteBlocked", name: found.title };
  if (!isPluginJar(jar)) return { error: "siteBadFile", name: found.title };
  return { jar, title: found.title };
}

/** The file at url, following redirects only to the download hosts; null if it leads elsewhere (the author's own site). */
async function fetchJar(url: string): Promise<Uint8Array<ArrayBuffer> | null> {
  for (let hops = 0; hops < 5; hops++) {
    const u = new URL(url);
    if (u.protocol !== "https:" && !process.env.SITE_PLUGIN_HOSTS) return null;
    if (!DOWNLOAD_HOSTS().includes(u.host)) return null;
    const res = await fetch(u, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
      cache: "no-store",
    });
    const next = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && next) {
      url = new URL(next, u).toString();
      continue;
    }
    if (!res.ok || !res.body) throw new Error(`${u.host} answered ${res.status}`);
    if (Number(res.headers.get("content-length") ?? 0) > MAX_JAR_BYTES) throw new Error("plugin too big");
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_JAR_BYTES) {
        await reader.cancel();
        throw new Error("plugin too big");
      }
      chunks.push(value);
    }
    return new Uint8Array(Buffer.concat(chunks));
  }
  throw new Error("too many redirects");
}

/** A zip with plugin.yml or paper-plugin.yml at its top (names in a zip's directory aren't compressed). */
export function isPluginJar(jar: Uint8Array) {
  if (jar.length < 4 || jar[0] !== 0x50 || jar[1] !== 0x4b || jar[2] !== 0x03 || jar[3] !== 0x04) return false;
  const text = Buffer.from(jar).toString("latin1");
  return /PK\x01\x02[\s\S]{42}(?:paper-)?plugin\.yml/.test(text);
}

/** A file at the top of a zip held in memory (stored or deflated), or null. */
function zipEntry(zip: Buffer, name: string): Buffer | null {
  // The end of central directory record sits in the last few bytes (after a comment of up to 64 KB).
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0 || eocd + 22 > zip.length) return null;
  const dirSize = zip.readUInt32LE(eocd + 12);
  const dirStart = zip.readUInt32LE(eocd + 16);
  if (dirStart + dirSize > zip.length) return null; // zip64 or cut short
  for (let at = dirStart; at + 46 <= dirStart + dirSize && zip.readUInt32LE(at) === 0x02014b50; ) {
    const method = zip.readUInt16LE(at + 10);
    const packed = zip.readUInt32LE(at + 20);
    const nameLen = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    if (zip.toString("utf8", at + 46, at + 46 + nameLen) === name) {
      if (packed > 4 << 20 || (method !== 0 && method !== 8) || local + 30 > zip.length) return null;
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + packed);
      try {
        return method === 0 ? data : inflateRawSync(data, { maxOutputLength: 4 << 20 });
      } catch {
        return null;
      }
    }
    at += 46 + nameLen + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return null;
}

/**
 * The Minecraft version a plugin jar says it's made for (api-version in its
 * plugin.yml or paper-plugin.yml, e.g. "1.21" or "1.20.4"); null if it says none.
 * Paper refuses to load a plugin whose api-version is newer than the server.
 */
export function pluginApiVersion(jar: Uint8Array): string | null {
  const zip = Buffer.from(jar.buffer, jar.byteOffset, jar.byteLength);
  for (const name of ["paper-plugin.yml", "plugin.yml"]) {
    const yml = zipEntry(zip, name)?.toString("utf8");
    const m = yml?.match(/^api-version:\s*["']?(\d+\.\d+(?:\.\d+)?)["']?\s*(?:#.*)?$/m);
    if (m) return m[1];
  }
  return null;
}

/** Whether a plugin made for api-version `api` is too new to load on Minecraft `mc`. */
export const apiTooNew = (api: string, mc: string) => compareVersions(api, mc) > 0;
