import "server-only";
import { auth } from "@/auth";
import { db } from "@/lib/db";

/**
 * The signed-in session, checked against the database: a session from before
 * the account's last password change (or of a deleted account) is treated as
 * signed out. The session cookie alone can't tell, so use this instead of
 * auth() wherever the dashboard needs the user.
 */
export async function getSession() {
  const session = await auth();
  if (!session?.user?.id) return null;
  const user = await db.user.findUnique({ where: { id: session.user.id }, select: { passwordChangedAt: true } });
  if (!user) return null;
  if (user.passwordChangedAt && (session.signedInAt ?? 0) < user.passwordChangedAt.getTime()) return null;
  return session;
}
