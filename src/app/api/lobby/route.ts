import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { isAdmin } from "@/lib/admin";
import { getPreferences } from "@/i18n/server";
import { readLobby } from "@/lib/lobby";

export const dynamic = "force-dynamic";

/**
 * Polled by an open players' chat: `?since=` returns the messages from then on
 * and those removed since; without it the latest ones and the viewer's servers.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "signedOut" }, { status: 401 });
  const since = req.nextUrl.searchParams.get("since");
  const from = since ? new Date(since) : null;
  const [{ locale }, admin] = await Promise.all([getPreferences(), isAdmin(session.user.id)]);
  const state = await readLobby(session.user.id, admin, locale, from && !isNaN(from.getTime()) ? from : undefined);
  return NextResponse.json(state, { headers: { "cache-control": "no-store" } });
}
