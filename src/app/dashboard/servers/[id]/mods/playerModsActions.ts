"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { getServerFor } from "@/lib/access";
import { hasPlayerMods, newPlayerModsToken } from "@/lib/playerMods";

// The players' link of "Mody dla graczy": make one (or a new one, which ends
// the old), or turn it off.

async function setToken(id: string, on: boolean) {
  const session = await getSession();
  if (!session?.user?.id) return;
  const server = await getServerFor(id, session.user.id, "plugins");
  if (!server || !hasPlayerMods(server)) return;
  await db.server.update({ where: { id: server.id }, data: { playerModsToken: on ? newPlayerModsToken() : null } });
  revalidatePath(`/dashboard/servers/${server.id}/mods`);
  revalidatePath(`/dashboard/servers/${server.id}/plugins`);
}

export async function makePlayerModsLink(id: string) {
  await setToken(id, true);
}

export async function removePlayerModsLink(id: string) {
  await setToken(id, false);
}
