import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { isAdmin } from "@/lib/admin";
import { getPreferences } from "@/i18n/server";
import { readChat, unreadCount } from "@/lib/support";
import { markAdminSeen } from "@/lib/presence";

export const dynamic = "force-dynamic";

/**
 * Polled by the open chat: `?since=` returns the messages from then on and
 * marks the chat read (`&chat=<user id>` reads a user's chat as an admin,
 * `&peek=1` leaves it unread: the help bubble loading it ahead of a click).
 * Without `since` it only returns the count for the badge in the top bar.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "signedOut" }, { status: 401 });
  const userId = session.user.id;
  const params = req.nextUrl.searchParams;
  const admin = await isAdmin(userId);
  const headers = { "cache-control": "no-store" };
  if (admin) markAdminSeen();

  const since = params.get("since");
  if (since === null) return NextResponse.json({ count: await unreadCount(userId, admin) }, { headers });

  const chat = params.get("chat");
  if (chat !== null && !admin) return NextResponse.json({ error: "notFound" }, { status: 404 });
  const from = new Date(since);
  const { locale } = await getPreferences();
  const state = await readChat(chat ?? userId, chat !== null ? "staff" : "user", locale, isNaN(from.getTime()) ? undefined : from, params.has("peek"));
  return NextResponse.json(state, { headers });
}
