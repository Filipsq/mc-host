"use server";

import { requireAdmin } from "@/lib/admin";
import { chatContextText, serverContextText } from "@/lib/claudeContext";

/** "Kopiuj dla Claude": the text about a customer's chat or a server, for admins only. */
export async function claudeContextAction(target: { userId: string } | { serverId: string }): Promise<string | null> {
  await requireAdmin();
  return "userId" in target ? chatContextText(target.userId) : serverContextText(target.serverId);
}
