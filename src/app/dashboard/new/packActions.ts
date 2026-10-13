"use server";

import { getSession } from "@/lib/session";
import { searchModpacks } from "@/lib/modrinth";

/** Mod packs on Modrinth for the "another pack" search on the new server page. */
export async function searchModpacksAction(query: string) {
  const session = await getSession();
  if (!session?.user?.id) return "modrinthUnavailable" as const;
  return searchModpacks(String(query).trim().slice(0, 100));
}
