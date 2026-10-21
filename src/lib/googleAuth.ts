import "server-only";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { getPreferences } from "@/i18n/server";
import { linkInvites } from "@/lib/access";
import { REFERRAL_COOKIE, inviterFor } from "@/lib/referrals";

/** "Sign in with Google" shows only once the OAuth client is set in deploy/.env. */
export const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

/**
 * The account a Google sign-in belongs to: the one already linked to this
 * Google account, else the one with the same email (linked now, so the
 * customer keeps their servers and can still use their password), else a new
 * account without a password. Null when Google hasn't confirmed the email,
 * since anyone could otherwise take over the account with that address.
 */
export async function googleUser(googleId: string, rawEmail: unknown, emailVerified: unknown) {
  const linked = await db.user.findUnique({ where: { googleId }, select: { id: true, email: true } });
  if (linked) return linked;
  if (typeof rawEmail !== "string" || emailVerified !== true) return null;
  const email = rawEmail.trim().toLowerCase();

  const existing = await db.user.findUnique({ where: { email }, select: { id: true, googleId: true } });
  if (existing) {
    // Already linked to a different Google account with this address: keep that one.
    if (existing.googleId) return null;
    await db.user.update({ where: { id: existing.id }, data: { googleId } });
    return { id: existing.id, email };
  }

  // New account, same as signing up with a password. The Google button says
  // continuing accepts the terms.
  const { locale } = await getPreferences();
  const jar = await cookies();
  const inviter = await inviterFor(jar.get(REFERRAL_COOKIE)?.value);
  const user = await db.user.create({
    data: { email, googleId, termsAcceptedAt: new Date(), locale, referredById: inviter?.id },
    select: { id: true, email: true },
  });
  if (inviter) jar.delete(REFERRAL_COOKIE);
  await linkInvites(user.id, email);
  return user;
}
