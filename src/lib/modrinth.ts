import "server-only";

// Looks up mod packs and plugins on Modrinth (https://docs.modrinth.com/api/).
// A mod pack server is pinned to one exact pack version that players can
// install too; plugins are found here and installed by the server's image.

const API = () => process.env.MODRINTH_API_URL ?? "https://api.modrinth.com";
// Modrinth asks API users to identify themselves.
const USER_AGENT = "Filipsq/mc-host (mchosting.pl)";

export type ResolvedPack = {
  slug: string;
  title: string;
  versionId: string;
  versionNumber: string;
  gameVersion: string;
  loader: string;
};
export type ResolveError = "modpackNotFound" | "modpackNotForServers" | "modrinthUnavailable";

type Project = { id: string; slug: string; title: string; project_type: string; server_side: string };
type Version = {
  id: string;
  version_number: string;
  version_type: string;
  game_versions: string[];
  loaders: string[];
  date_published: string;
};

const LOADERS = ["fabric", "forge", "neoforge", "quilt"];
const RELEASE = /^\d+\.\d+(\.\d+)?$/;

async function get<T>(path: string): Promise<T | null> {
  const res = await fetch(API() + path, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Modrinth answered ${res.status} for ${path}`);
  return res.json() as Promise<T>;
}

// "1.21.1" > "1.20.6", "26.1" > "1.21.11"
function compareVersions(a: string, b: string) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/** The pack's newest release (or the version in the link), with its Minecraft version and loader. */
export async function resolveModpack(ref: { slug: string; version?: string }): Promise<ResolvedPack | ResolveError> {
  try {
    const project = await get<Project>(`/v2/project/${encodeURIComponent(ref.slug)}`);
    if (!project || project.project_type !== "modpack") return "modpackNotFound";
    if (project.server_side === "unsupported") return "modpackNotForServers";

    let versions: Version[];
    if (ref.version) {
      const one = await get<Version>(`/v2/project/${project.id}/version/${encodeURIComponent(ref.version)}`);
      if (!one) return "modpackNotFound";
      versions = [one];
    } else {
      versions = ((await get<Version[]>(`/v2/project/${project.id}/version`)) ?? []).sort((a, b) =>
        b.date_published.localeCompare(a.date_published),
      );
    }
    const version = versions.find((v) => v.version_type === "release") ?? versions[0];
    if (!version) return "modpackNotFound";
    const gameVersion = version.game_versions.filter((g) => RELEASE.test(g)).sort(compareVersions).at(-1);
    const loader = version.loaders.find((l) => LOADERS.includes(l));
    if (!gameVersion || !loader) return "modpackNotForServers";
    return {
      // The agent only takes plain slugs; the project ID works wherever a slug does.
      slug: /^[A-Za-z0-9_-]{2,64}$/.test(project.slug) ? project.slug : project.id,
      title: project.title.slice(0, 80),
      versionId: version.id,
      versionNumber: version.version_number.slice(0, 64),
      gameVersion,
      loader,
    };
  } catch (err) {
    console.error("modrinth lookup failed", ref, err);
    return "modrinthUnavailable";
  }
}

export type PluginInfo = { id: string; slug: string; title: string; description: string; icon?: string };
export type PluginHit = PluginInfo & { downloads: number; newestVersion?: string };

type SearchHit = {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  downloads: number;
  icon_url?: string | null;
  versions: string[];
};
type PluginProject = Project & { description: string; icon_url?: string | null; loaders: string[] };

// What Paper runs: plugins for it and the servers it's built on.
const PLUGIN_LOADERS = ["paper", "spigot", "bukkit", "purpur", "folia"];

/** The path of a plugin icon on Modrinth's CDN, if the URL is one (raster images only). */
export function iconPath(url: string) {
  const m = url.match(/^https:\/\/cdn\.modrinth\.com(\/data\/[A-Za-z0-9]{8}\/[A-Za-z0-9_-]+\.(?:png|webp|jpe?g|gif))$/);
  return m?.[1] ?? null;
}

const info = (p: { slug: string; title: string; description: string; icon_url?: string | null }, id: string): PluginInfo => ({
  id,
  slug: p.slug,
  title: p.title.slice(0, 80),
  description: p.description.slice(0, 200),
  // Shown through /api/plugin-icon, so browsers don't fetch from Modrinth themselves.
  icon: p.icon_url && iconPath(p.icon_url) ? `/api/plugin-icon?src=${encodeURIComponent(p.icon_url)}` : undefined,
});

/** Paper plugins matching the query, or the most downloaded ones; for a Minecraft version if given. */
export async function searchPlugins(query: string, gameVersion?: string): Promise<PluginHit[] | "modrinthUnavailable"> {
  const facets = [
    ["project_type:plugin"],
    PLUGIN_LOADERS.slice(0, 3).map((l) => `categories:${l}`),
    ["server_side:required", "server_side:optional"],
  ];
  if (gameVersion) facets.push([`versions:${gameVersion}`]);
  const params = new URLSearchParams({
    query: query.slice(0, 100),
    limit: "20",
    index: query ? "relevance" : "downloads",
    facets: JSON.stringify(facets),
  });
  try {
    const res = await get<{ hits: SearchHit[] }>(`/v2/search?${params}`);
    return (res?.hits ?? []).map((h) => ({
      ...info(h, h.project_id),
      downloads: h.downloads,
      newestVersion: h.versions.filter((g) => RELEASE.test(g)).sort(compareVersions).at(-1),
    }));
  } catch (err) {
    console.error("modrinth search failed", query, err);
    return "modrinthUnavailable";
  }
}

/** A plugin that runs on Paper servers, by project ID or slug. */
export async function getPlugin(ref: string): Promise<PluginInfo | "pluginNotFound" | "modrinthUnavailable"> {
  try {
    const p = await get<PluginProject>(`/v2/project/${encodeURIComponent(ref)}`);
    if (!p || p.server_side === "unsupported" || !p.loaders.some((l) => PLUGIN_LOADERS.includes(l))) return "pluginNotFound";
    return info(p, p.id);
  } catch (err) {
    console.error("modrinth lookup failed", ref, err);
    return "modrinthUnavailable";
  }
}

/** Names and icons of the given projects, by ID. Empty if Modrinth can't be reached. */
export async function getPluginInfos(ids: string[]): Promise<Map<string, PluginInfo>> {
  if (ids.length === 0) return new Map();
  try {
    const list = (await get<PluginProject[]>(`/v2/projects?ids=${encodeURIComponent(JSON.stringify(ids))}`)) ?? [];
    return new Map(list.map((p) => [p.id, info(p, p.id)]));
  } catch (err) {
    console.error("modrinth lookup failed", ids, err);
    return new Map();
  }
}
