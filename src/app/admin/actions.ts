"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { giftDays } from "@/lib/billing";
import { db } from "@/lib/db";
import { destroyServer } from "@/lib/servers";
import { getPreferences } from "@/i18n/server";

export type GiftState = { error?: "invalid" | "free" | "soldOut" | "failed"; days?: number; date?: string };

/** Extends a paid server's period for free (see giftDays). */
export async function giftDaysAction(id: string, _: GiftState, form: FormData): Promise<GiftState> {
  await requireAdmin();
  const days = Number(form.get("days"));
  if (!Number.isInteger(days) || days < 1 || days > 365) return { error: "invalid" };
  const { error, server } = await giftDays(id, days);
  revalidatePath(`/admin/servers/${id}`);
  const { locale } = await getPreferences();
  const date = server?.paidUntil?.toLocaleString(locale, { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Warsaw" });
  return { error, days, date };
}

export async function deleteServerAdminAction(id: string): Promise<{ error?: "failed" }> {
  await requireAdmin();
  const server = await db.server.findUnique({ where: { id }, select: { id: true } });
  if (server) {
    try {
      await destroyServer(server);
    } catch (err) {
      console.error("admin: delete failed", id, err);
      return { error: "failed" };
    }
    console.info("admin deleted server", id);
  }
  redirect("/admin/servers");
}
