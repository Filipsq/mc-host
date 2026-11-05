"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { REVIEW_NAME_MAX, REVIEW_TEXT_MAX, reviewEdition, shouldAskReview } from "@/lib/reviews";

export type ReviewState = { error?: "stars" | "text" | "name"; saved?: boolean };

const schema = z.object({
  stars: z.coerce.number().int().min(1).max(5),
  text: z.string().trim().min(10).max(REVIEW_TEXT_MAX),
  name: z.string().trim().min(2).max(REVIEW_NAME_MAX),
});

/** Saves the player's opinion; it waits for an admin before the home page shows it. */
export async function submitReviewAction(_: ReviewState, form: FormData): Promise<ReviewState> {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) return { error: "text" };
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return { error: field === "stars" || field === "name" ? field : "text" };
  }
  // Only someone the panel asked can write one, so every opinion comes from real use.
  if (!(await shouldAskReview(userId))) return { saved: true };
  const game = await reviewEdition(userId);
  await db.review.create({ data: { userId, ...parsed.data, game } }).catch(() => null); // a second click finds it made
  console.info("review saved", userId, parsed.data.stars);
  revalidatePath("/dashboard");
  return { saved: true };
}

/** "Nie teraz": the panel stops asking. */
export async function dismissReviewAction() {
  const session = await getSession();
  if (!session?.user?.id) return;
  await db.user.update({ where: { id: session.user.id }, data: { reviewDismissedAt: new Date() } });
  revalidatePath("/dashboard");
}
