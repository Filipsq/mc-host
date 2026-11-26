"use server";

import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { getServerAccess } from "@/lib/access";
import { isQuestKey } from "@/lib/quests";

// Only the owner's own steps count: an admin helping or a friend opening a tab doesn't do the owner's quests.
async function ownServer(id: string) {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) return null;
  const access = await getServerAccess(id, userId);
  return access?.role === "owner" ? access.server : null;
}

/** Marks a quest of the Księga questów done. */
export async function doQuestAction(id: string, key: string) {
  if (!isQuestKey(key)) return;
  const server = await ownServer(id);
  if (!server || server.questsDone.includes(key)) return;
  await db.server.update({ where: { id }, data: { questsDone: { push: key } } });
}

/** Hides the Księga questów, or brings it back. */
export async function hideQuestsAction(id: string, hidden: boolean) {
  const server = await ownServer(id);
  if (!server) return;
  await db.server.update({ where: { id }, data: { questsHidden: hidden } });
}
