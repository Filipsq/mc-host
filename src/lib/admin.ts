import "server-only";
import { notFound } from "next/navigation";
import { db } from "./db";
import { getSession } from "./session";

// Admins are marked in the database by deploy/admin.sh, so only someone with
// access to the machine can make one; the site itself never grants it.

export async function isAdmin(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { admin: true } });
  return user?.admin === true;
}

/** The signed-in admin's session; anyone else gets a plain 404, so the panel doesn't announce itself. */
export async function requireAdmin() {
  const session = await getSession();
  if (!session?.user?.id || !(await isAdmin(session.user.id))) notFound();
  return session;
}
