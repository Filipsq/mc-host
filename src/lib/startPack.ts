/** Holds the mod pack someone picked on the home page before signing up, to open it on the create page after (src/app/graj). */
export const START_PACK_COOKIE = "start-pack";

const SLUG = /^[A-Za-z0-9_-]{2,64}$/;

/** "pack:<modrinth slug>" or "cf:<curseforge slug>" as the create page's query, or null for anything else. */
export function startPackQuery(value: string | undefined | null) {
  const m = value?.match(/^(pack|cf):(.+)$/);
  return m && SLUG.test(m[2]) ? `${m[1]}=${encodeURIComponent(m[2])}` : null;
}
