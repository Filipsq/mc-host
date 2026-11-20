"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { isAdmin } from "@/lib/admin";
import { getPreferences } from "@/i18n/server";
import {
  keepLobbyMessage,
  muteUser,
  postLobby,
  removeAllBy,
  removeLobbyMessage,
  reportLobby,
  resetChatName,
  setChatName,
  setLobbyOn,
  unmuteUser,
  type PostResult,
} from "@/lib/lobby";

async function viewer() {
  const session = await getSession();
  const id = session?.user?.id;
  if (!id) return null;
  return { id, admin: await isAdmin(id) };
}

/** Picks the signed-in user's nickname in the players' chat. */
export async function setChatNameAction(name: string) {
  const v = await viewer();
  if (!v) return { ok: false as const, error: "signedOut" as const };
  return setChatName(v.id, v.admin, String(name));
}

/** Sends a message to the players' chat, optionally with one of the user's servers. */
export async function sendLobbyMessage(text: string, serverId?: string): Promise<PostResult> {
  const v = await viewer();
  if (!v) return { ok: false, error: "signedOut" };
  const { locale } = await getPreferences();
  return postLobby(v.id, v.admin, String(text), locale, serverId ? String(serverId) : undefined);
}

export async function reportLobbyMessage(messageId: string, reason: string) {
  const v = await viewer();
  if (!v) return { ok: false };
  return reportLobby(v.id, String(messageId), String(reason));
}

// ---- Admins ----

export type ModAction =
  | { kind: "delete"; messageId: string }
  | { kind: "keep"; messageId: string }
  | { kind: "mute"; userId: string; hours: number | null }
  | { kind: "unmute"; userId: string }
  | { kind: "resetName"; userId: string }
  | { kind: "removeAll"; userId: string }
  | { kind: "switch"; on: boolean };

const MUTE_HOURS = [1, 24, 24 * 7];

export async function moderateLobby(action: ModAction): Promise<{ ok: boolean }> {
  const v = await viewer();
  if (!v?.admin) return { ok: false };
  switch (action.kind) {
    case "delete":
      await removeLobbyMessage(String(action.messageId));
      break;
    case "keep":
      await keepLobbyMessage(String(action.messageId));
      break;
    case "mute":
      if (action.hours !== null && !MUTE_HOURS.includes(Number(action.hours))) return { ok: false };
      await muteUser(String(action.userId), action.hours === null ? null : Number(action.hours));
      break;
    case "unmute":
      await unmuteUser(String(action.userId));
      break;
    case "resetName":
      await resetChatName(String(action.userId));
      break;
    case "removeAll":
      await removeAllBy(String(action.userId));
      break;
    case "switch":
      await setLobbyOn(action.on === true);
      break;
    default:
      return { ok: false };
  }
  revalidatePath("/admin/chat");
  return { ok: true };
}
