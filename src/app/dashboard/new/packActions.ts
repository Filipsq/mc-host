"use server";

import { getSession } from "@/lib/session";
import { searchModpacks, type PackHit } from "@/lib/modrinth";
import { searchCurseforgePacks } from "@/lib/curseforge";

/**
 * Mod packs on Modrinth and CurseForge for the "another pack" search on the new
 * server and type change pages, Modrinth's first. Unavailable only if neither answers.
 */
export async function searchModpacksAction(query: string): Promise<PackHit[] | "modrinthUnavailable"> {
  const session = await getSession();
  if (!session?.user?.id) return "modrinthUnavailable";
  const q = String(query).trim().slice(0, 100);
  const [modrinth, curseforge] = await Promise.all([searchModpacks(q), searchCurseforgePacks(q)]);
  const lists = [modrinth, curseforge].filter((l) => typeof l !== "string");
  return lists.length ? lists.flat() : "modrinthUnavailable";
}
