import "server-only";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

export const RESET_LINK_MINUTES = 60;
// Links one account can ask for per hour, so nobody can flood someone's inbox.
const MAX_LINKS_PER_HOUR = 3;
const HOUR = 60 * 60 * 1000;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Makes a reset token for the account with this email. Returns null when there
 * is no such account or it asked for too many links lately; the caller says the
 * same thing either way, so the form doesn't reveal who has an account.
 */
export async function createResetToken(email: string): Promise<string | null> {
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return null;
  const now = Date.now();
  const recent = await db.passwordReset.count({
    where: { userId: user.id, createdAt: { gt: new Date(now - HOUR) } },
  });
  if (recent >= MAX_LINKS_PER_HOUR) return null;

  return issueToken(user.id, RESET_LINK_MINUTES);
}

/** How long a link made by an admin works: the customer may read the chat only later. */
export const ADMIN_LINK_HOURS = 24;

/**
 * A reset link an admin hands to the account's owner, e.g. in the support chat
 * when the email doesn't arrive. Not counted against the hourly limit.
 */
export async function createAdminResetLink(userId: string): Promise<string> {
  const token = await issueToken(userId, ADMIN_LINK_HOURS * 60);
  return `${process.env.APP_URL ?? "http://localhost:3000"}/nowe-haslo?token=${token}`;
}

async function issueToken(userId: string, minutes: number) {
  const now = Date.now();
  const token = randomBytes(32).toString("base64url");
  await db.$transaction([
    db.passwordReset.deleteMany({ where: { userId, createdAt: { lt: new Date(now - 24 * HOUR) }, expiresAt: { lt: new Date(now) } } }),
    db.passwordReset.create({
      data: { userId, tokenHash: hash(token), expiresAt: new Date(now + minutes * 60 * 1000) },
    }),
  ]);
  return token;
}

/** The reset link's account, while the link is unused and not expired. */
export async function findValidReset(token: string) {
  if (!token) return null;
  const reset = await db.passwordReset.findUnique({
    where: { tokenHash: hash(token) },
    include: { user: { select: { email: true } } },
  });
  if (!reset || reset.usedAt || reset.expiresAt < new Date()) return null;
  return reset;
}

/**
 * Sets the new password, uses up every open link of the account and ends its
 * other sessions. Returns the account's email, or null when the link is no
 * longer valid.
 */
export async function resetPassword(token: string, password: string): Promise<string | null> {
  const reset = await findValidReset(token);
  if (!reset) return null;
  const passwordHash = await bcrypt.hash(password, 12);
  const now = new Date();
  // Claim the link first, so two submits of the same link can't both use it.
  const claimed = await db.passwordReset.updateMany({ where: { id: reset.id, usedAt: null }, data: { usedAt: now } });
  if (claimed.count === 0) return null;
  await db.$transaction([
    db.user.update({ where: { id: reset.userId }, data: { passwordHash, passwordChangedAt: now } }),
    db.passwordReset.updateMany({ where: { userId: reset.userId, usedAt: null }, data: { usedAt: now } }),
  ]);
  return reset.user.email;
}

/**
 * Changes the password of a signed-in account after checking the current one.
 * Ends the account's other sessions, like a reset does.
 */
export async function changePassword(userId: string, current: string, next: string): Promise<"ok" | "wrongPassword"> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user || !(await bcrypt.compare(current, user.passwordHash))) return "wrongPassword";
  const passwordHash = await bcrypt.hash(next, 12);
  const now = new Date();
  await db.$transaction([
    db.user.update({ where: { id: userId }, data: { passwordHash, passwordChangedAt: now } }),
    db.passwordReset.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } }),
  ]);
  return "ok";
}
