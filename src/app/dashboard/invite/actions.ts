"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { giftDays } from "@/lib/billing";

export type RedeemError = "noDays" | "free" | "soldOut" | "notFound";

/**
 * Adds all the user's free days from invites to one of their paid servers. A
 * suspended or unpaid one starts again if there's room on the machine; if
 * there isn't, the days stay for later.
 */
async function redeemBonusDays(userId: string, serverId: string): Promise<{ error?: RedeemError; days?: number }> {
  const server = await db.server.findFirst({ where: { id: serverId, ownerId: userId }, select: { id: true, plan: true } });
  if (!server) return { error: "notFound" };
  if (server.plan === "FREE") return { error: "free" };
  const { bonusDays } = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { bonusDays: true } });
  if (bonusDays <= 0) return { error: "noDays" };
  // Taken before they're added, so two clicks can't spend the same days twice.
  const taken = await db.user.updateMany({ where: { id: userId, bonusDays }, data: { bonusDays: { decrement: bonusDays } } });
  if (taken.count === 0) return { error: "noDays" };
  const result = await giftDays(server.id, bonusDays, "referral days");
  if (result.error === "soldOut" || result.error === "free") {
    await db.user.update({ where: { id: userId }, data: { bonusDays: { increment: bonusDays } } });
    return { error: result.error };
  }
  // "failed" means the days were added but the server didn't start yet; the billing job retries it.
  return { days: bonusDays };
}

export async function redeemAction(form: FormData) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const serverId = String(form.get("server") ?? "");
  const result = await redeemBonusDays(session.user.id, serverId);
  revalidatePath("/dashboard/invite");
  if (result.error) redirect(`/dashboard/invite?blad=${result.error}`);
  redirect(`/dashboard/invite?dodano=${result.days}&serwer=${encodeURIComponent(serverId)}`);
}
