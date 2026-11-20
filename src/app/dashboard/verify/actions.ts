"use server";

import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { sendVerifyMail } from "@/lib/emailVerify";
import { hit, isLimited } from "@/lib/rateLimit";

export type VerifyState = { sent?: boolean; error?: "tooMany" };

const LINKS = { max: 3, windowMs: 60 * 60_000 };

/** Emails the signed-in user a link that confirms their address. */
export async function sendVerifyLinkAction(): Promise<VerifyState> {
  const session = await getSession();
  if (!session?.user?.id) return {};
  const user = await db.user.findUnique({ where: { id: session.user.id }, select: { id: true, email: true, locale: true, emailVerifiedAt: true } });
  if (!user || user.emailVerifiedAt) return {};
  const key = `verify-email:${user.id}`;
  if (isLimited(key, LINKS.max, LINKS.windowMs)) return { error: "tooMany" };
  hit(key);
  try {
    await sendVerifyMail(user);
  } catch (err) {
    console.error("[mail] email confirmation failed", user.id, err);
  }
  return { sent: true };
}
