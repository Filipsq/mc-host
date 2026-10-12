import "server-only";

// Looks up mod packs on Modrinth (https://docs.modrinth.com/api/), so a server
// is pinned to one exact pack version that players can install too.

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
