import { cache } from "react";
import { db } from "@/lib/db";

/**
 * Whether this user picked the classic server panel: everything on the overview
 * (console, backups, a card per section) with no menu on the left, as it was
 * before 25.10.2026. Remembered on the account, so it follows them to every
 * device. Read once per request by the panel's frame and its pages.
 */
export const usesClassicPanel = cache(async (userId: string) => {
  const user = await db.user.findUnique({ where: { id: userId }, select: { classicPanel: true } });
  return user?.classicPanel ?? false;
});
