import "server-only";
import { notFound, redirect } from "next/navigation";
import { db } from "./db";
import { getSession } from "./session";
import { passedTwoFactor } from "./adminTwoFactor";

// Admins are marked in the database by deploy/admin.sh, so only someone with
// access to the machine can make one; the site itself never grants it.
// Their powers also need the second step (a code from an authenticator app,
// src/lib/adminTwoFactor.ts), so a stolen password alone gets nothing.

/** Whether the account is marked as an admin, whatever this sign-in proved. Only for showing the way to /admin. */
export async function isAdminAccount(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { admin: true } });
  return user?.admin === true;
}

/** Whether the signed-in user may act as an admin right now: an admin account that passed the second step. */
export async function isAdmin(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { admin: true, totpEnabledAt: true } });
  if (user?.admin !== true || !user.totpEnabledAt) return false;
  return passedTwoFactor(userId);
}

/**
 * The signed-in admin's session; anyone else gets a plain 404, so the panel
 * doesn't announce itself. An admin without the second step goes to /2fa first.
 */
export async function requireAdmin() {
  const session = await getSession();
  if (!session?.user?.id || !(await isAdminAccount(session.user.id))) notFound();
  if (!(await isAdmin(session.user.id))) redirect("/2fa");
  return session;
}
