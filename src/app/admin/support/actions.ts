"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { botConfigured, setBotEnabled } from "@/lib/supportBotState";

/** Switches the support bot (OpenBot) on or off for every chat. */
export async function setSupportBotAction(enabled: boolean) {
  await requireAdmin();
  if (enabled && !botConfigured()) return;
  await setBotEnabled(!!enabled);
  revalidatePath("/admin/support");
}
