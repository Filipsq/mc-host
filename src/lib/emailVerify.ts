import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { linkInvites } from "./access";
import { buttonMail, sendMail } from "./mail";
import { siteUrl } from "./site";
import { BRAND_NAME } from "./brand";
import { messages, format } from "@/i18n/messages";
import { defaultLocale, isLocale } from "@/i18n/config";

// Sign-up doesn't check the email, so anyone could make an account on someone
// else's address. Friends' servers shared with an address therefore join an
// account only once its owner proves the address: by a link we email, by a
// password reset (also a link we email) or by signing in with Google.

const LINK_HOURS = 48;

const sign = (userId: string, email: string, expires: number) =>
  createHmac("sha256", process.env.AUTH_SECRET ?? "").update(`verify-email:${userId}:${email}:${expires}`).digest("base64url");

/** A link token for this account and address: "<userId>.<expires>.<signature>". */
export function verifyToken(userId: string, email: string, now = Date.now()) {
  const expires = now + LINK_HOURS * 60 * 60 * 1000;
  return `${userId}.${expires}.${sign(userId, email, expires)}`;
}

/** Confirms the account's address if the token is ours, unexpired and for its current address. Returns the email or null. */
export async function confirmEmail(token: string): Promise<string | null> {
  const [userId, expiresRaw, given] = token.split(".");
  const expires = Number(expiresRaw);
  if (!userId || !given || !(expires > Date.now()) || !process.env.AUTH_SECRET) return null;
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true, deletedAt: true } });
  if (!user || user.deletedAt) return null;
  const expected = Buffer.from(sign(userId, user.email, expires));
  const got = Buffer.from(given);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  await markVerified(userId, user.email);
  return user.email;
}

/** The address is the user's: remembered, and friends' servers waiting for it join their list. */
export async function markVerified(userId: string, email: string) {
  await db.user.updateMany({ where: { id: userId, emailVerifiedAt: null }, data: { emailVerifiedAt: new Date() } });
  await linkInvites(userId, email);
}

/** Friends' servers shared with this address that wait for it to be confirmed. */
export function pendingInvites(email: string) {
  return db.serverMember.count({ where: { email, userId: null } });
}

/** Emails the confirmation link. */
export async function sendVerifyMail(user: { id: string; email: string; locale: string }) {
  const all = messages[isLocale(user.locale) ? user.locale : defaultLocale];
  const t = all.emailVerify.mail;
  const app = siteUrl();
  const vars = { brand: BRAND_NAME, email: user.email, hours: LINK_HOURS };
  await sendMail(
    buttonMail({
      to: user.email,
      subject: format(t.subject, vars),
      paragraphs: [format(t.intro, vars), format(t.ignore, vars)],
      button: t.button,
      url: `${app}/potwierdz-email?t=${encodeURIComponent(verifyToken(user.id, user.email))}`,
      footer: format(t.footer, { brand: BRAND_NAME, contact: `${app}/kontakt` }),
    }),
  );
}
