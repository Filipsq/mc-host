"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";

/** Shows an opinion on the home page or takes it off; either way it counts as checked. */
export async function setReviewShownAction(id: string, shown: boolean) {
  await requireAdmin();
  await db.review.update({ where: { id }, data: { shown, checkedAt: new Date() } });
  console.info("admin review", id, shown ? "shown" : "hidden");
  revalidatePath("/admin/reviews");
  revalidatePath("/");
}
