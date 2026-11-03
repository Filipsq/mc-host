"use server";

import { getSession } from "@/lib/session";
import { freeLimitReached } from "@/lib/freeLimit";
import { getPreferences } from "@/i18n/server";
import { suggestServer } from "@/lib/ai";

/** The AI creator on the new server page: a setup for the signed-in player's description. */
export async function suggestServerAction(description: string) {
  const session = await getSession();
  if (!session?.user?.id) return { ok: false as const, error: "failed" as const };
  const [{ locale }, hasFree] = await Promise.all([getPreferences(), freeLimitReached(session.user.id)]);
  return suggestServer(session.user.id, String(description), { locale, hasFree });
}
