import "server-only";
import { CURATED_PACKS, parseCurseforgeLink, parseModrinthLink } from "./modpacks";
import { resolveModpack, type ResolveError, type ResolvedPack } from "./modrinth";
import { curseforgeEnabled, resolveCurseforgePack, type CurseforgeError } from "./curseforge";

/** A mod pack pinned to one version, from either site; ramGb is what it needs, when we know. */
export type PackChoice = ResolvedPack & { source: "modrinth" | "curseforge"; ramGb?: number };
export type PackChoiceError = ResolveError | CurseforgeError | "modpackLink";

export type PackForm = { pack?: string; packLink?: string; cfPack?: string };

/** The CurseForge pack picked from the list: `pack` "curseforge:<slug>", or "curseforge" with `cfPack`. */
function listedCurseforge(f: PackForm) {
  if (f.pack?.startsWith("curseforge:")) return f.pack.slice("curseforge:".length) || undefined;
  return f.pack === "curseforge" ? f.cfPack : undefined;
}

/** Whether the form names a pack at all, before asking either site about it. */
export function packNamed(f: PackForm) {
  return (
    CURATED_PACKS.some((p) => p.slug === f.pack) ||
    !!listedCurseforge(f) ||
    !!parseModrinthLink(f.packLink ?? "") ||
    !!parseCurseforgeLink(f.packLink ?? "")
  );
}

/**
 * The pack a form picked: a curated one (`pack` is its slug), a CurseForge
 * pack from the list (`pack` "curseforge:<slug>", or "curseforge" and `cfPack` its slug), or a
 * pasted Modrinth or CurseForge link, or a pack found in the Modrinth search (`packLink`).
 */
export async function resolvePackChoice(f: PackForm): Promise<PackChoice | PackChoiceError> {
  const curated = CURATED_PACKS.find((p) => p.slug === f.pack);
  const listed = listedCurseforge(f);
  const fromList = !!listed || f.pack === "curseforge";
  const cf = curated ? null : fromList ? (listed ? { slug: listed } : null) : parseCurseforgeLink(f.packLink ?? "");
  if (cf) {
    if (!curseforgeEnabled()) return "modpackLink";
    const p = await resolveCurseforgePack(cf);
    if (typeof p === "string") return p;
    return {
      source: "curseforge",
      slug: p.slug,
      title: p.title,
      versionId: String(p.fileId),
      versionNumber: p.fileName,
      gameVersion: p.gameVersion,
      loader: p.loader,
      ramGb: p.ramGb,
    };
  }
  const ref = curated ? { slug: curated.slug } : fromList ? null : parseModrinthLink(f.packLink ?? "");
  if (!ref) return "modpackLink";
  const p = await resolveModpack(ref);
  return typeof p === "string" ? p : { ...p, source: "modrinth", ramGb: curated?.ramGb };
}

/** The Server fields for a pack (all cleared without one). */
export const packFields = (pack: PackChoice | null) => ({
  modpack: pack?.slug ?? null,
  modpackSource: pack?.source === "curseforge" ? "curseforge" : null,
  modpackTitle: pack?.title ?? null,
  modpackVersionId: pack?.versionId ?? null,
  modpackVersion: pack?.versionNumber ?? null,
  modpackLoader: pack?.loader ?? null,
});
