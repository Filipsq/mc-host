"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { checkCode } from "@/lib/totp";
import { rememberTwoFactor } from "@/lib/adminTwoFactor";
import { hit, isLimited } from "@/lib/rateLimit";
import type { Messages } from "@/i18n/messages";

export type TwoFactorState = { error?: keyof Messages["twoFactor"]["errors"] };

const TRIES = { max: 5, windowMs: 15 * 60_000 };

/** Checks the app's code: turns the second step on the first time, then lets this sign-in into /admin. */
export async function verifyTwoFactor(_: TwoFactorState, form: FormData): Promise<TwoFactorState> {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const user = await db.user.findUnique({ where: { id: userId }, select: { admin: true, totpSecret: true, totpLastStep: true } });
  if (!user?.admin || !user.totpSecret) redirect("/dashboard");
  const key = `2fa:${userId}`;
  if (isLimited(key, TRIES.max, TRIES.windowMs)) return { error: "tooMany" };
  const step = checkCode(user.totpSecret, String(form.get("code") ?? ""), user.totpLastStep);
  if (step === null) {
    hit(key);
    return { error: "wrongCode" };
  }
  // Only one sign-in can use a code: the update counts only if no one used this step meanwhile.
  const used = await db.user.updateMany({
    where: { id: userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
    data: { totpLastStep: step },
  });
  if (used.count === 0) return { error: "wrongCode" };
  await db.user.updateMany({ where: { id: userId, totpEnabledAt: null }, data: { totpEnabledAt: new Date() } });
  await rememberTwoFactor(userId);
  redirect("/admin");
}
