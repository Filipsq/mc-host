"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { botConfigured, setBotSwitch } from "@/lib/supportBotState";

/** Switches the support bot (OpenBot) on or off for while an admin is on the site, or while none is. */
export async function setSupportBotAction(which: "whenOnline" | "whenOffline", on: boolean) {
  await requireAdmin();
  if (which !== "whenOnline" && which !== "whenOffline") return;
  if (on && !botConfigured()) return;
  await setBotSwitch(which, !!on);
  revalidatePath("/admin/support");
}
