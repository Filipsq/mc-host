"use server";

import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { getPreferences } from "@/i18n/server";
import { suggestServer } from "@/lib/ai";

/** The AI creator on the new server page: a setup for the signed-in player's description. */
export async function suggestServerAction(description: string) {
  const session = await getSession();
  if (!session?.user?.id) return { ok: false as const, error: "failed" as const };
  const [{ locale }, freeCount] = await Promise.all([
    getPreferences(),
    db.server.count({ where: { ownerId: session.user.id, plan: "FREE" } }),
  ]);
  return suggestServer(session.user.id, String(description), { locale, hasFree: freeCount > 0 });
}
