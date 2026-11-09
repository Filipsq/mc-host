"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { after } from "next/server";
import { db } from "@/lib/db";
import { REVIEW_REPLY_MAX, notifyReviewReply } from "@/lib/reviews";

/** Shows an opinion on the home page or takes it off; either way it counts as checked. */
export async function setReviewShownAction(id: string, shown: boolean) {
  await requireAdmin();
  await db.review.update({ where: { id }, data: { shown, checkedAt: new Date() } });
  console.info("admin review", id, shown ? "shown" : "hidden");
  revalidatePath("/admin/reviews");
  revalidatePath("/");
}

/**
 * Saves the admin's public answer under an opinion (empty text takes it off).
 * A new or changed answer is mailed and pushed to the author and shown in their panel.
 */
export async function saveReviewReplyAction(id: string, form: FormData) {
  await requireAdmin();
  const reply = String(form.get("reply") ?? "").trim().slice(0, REVIEW_REPLY_MAX);
  const before = await db.review.findUnique({ where: { id }, select: { reply: true } });
  if (!before) return;
  if (!reply) {
    await db.review.update({ where: { id }, data: { reply: null, repliedAt: null, replySeenAt: null, checkedAt: new Date() } });
    console.info("admin review reply removed", id);
  } else if (reply !== before.reply) {
    await db.review.update({ where: { id }, data: { reply, repliedAt: new Date(), checkedAt: new Date() } });
    console.info("admin review reply", id);
    after(() => notifyReviewReply(id));
  }
  revalidatePath("/admin/reviews");
  revalidatePath("/");
}
