"use server";

import { getSession } from "@/lib/session";
import { isAdmin } from "@/lib/admin";
import { getPreferences } from "@/i18n/server";
import { format, messages } from "@/i18n/messages";
import { getServerFor } from "@/lib/access";
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

/**
 * Sends a server's console to the admins from its console page, as a message
 * in the user's own chat that shows the log and links the server.
 */
export async function sendConsoleToAdmin(serverId: string, log: string): Promise<SendResult | { ok: false; error: "signedOut" }> {
  const session = await getSession();
  if (!session?.user?.id) return { ok: false, error: "signedOut" };
  const server = await getServerFor(String(serverId), session.user.id, "console");
  if (!server) return { ok: false, error: "signedOut" };
  const text = String(log).replace(/\r\n?/g, "\n").trim();
  if (!text) return { ok: false, error: "empty" };
  const { locale } = await getPreferences();
  const body = format(messages[locale].support.consoleMessage, { name: server.name });
  return postMessage(session.user.id, "user", session.user.id, body, locale, undefined, { text, server: server.id });
}
