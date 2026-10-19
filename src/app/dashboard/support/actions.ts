"use server";

import { getSession } from "@/lib/session";
import { isAdmin } from "@/lib/admin";
import { getPreferences } from "@/i18n/server";
import { deleteMessage, postMessage, type SendResult } from "@/lib/support";

/**
 * Sends a chat message: to the admins from the signed-in user's own chat, or,
 * with `chat` (a user's id), from an admin into that user's chat.
 */
export async function sendSupportMessage(text: string, chat?: string): Promise<SendResult | { ok: false; error: "signedOut" }> {
  const session = await getSession();
  if (!session?.user?.id) return { ok: false, error: "signedOut" };
  const { locale } = await getPreferences();
  if (chat !== undefined) {
    if (!(await isAdmin(session.user.id))) return { ok: false, error: "signedOut" };
    return postMessage(chat, "staff", session.user.id, String(text), locale);
  }
  return postMessage(session.user.id, "user", session.user.id, String(text), locale);
}

/** An admin removes a message from a user's chat. */
export async function deleteSupportMessage(chat: string, messageId: string): Promise<{ ok: boolean }> {
  const session = await getSession();
  if (!session?.user?.id || !(await isAdmin(session.user.id))) return { ok: false };
  return { ok: await deleteMessage(String(chat), String(messageId)) };
}
