import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { PUSH_COOKIE, isPushEndpoint } from "@/lib/pushEndpoint";

export const dynamic = "force-dynamic";

const Subscription = z.object({
  endpoint: z.string().max(1000).refine(isPushEndpoint),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

/**
 * Saves this browser's push subscription for the signed-in user. The panel
 * also calls it on every visit, so a phone that already allowed notifications
 * follows whoever is signed in on it.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "signedOut" }, { status: 401 });
  const parsed = Subscription.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { endpoint, keys } = parsed.data;
  const data = { userId: session.user.id, p256dh: keys.p256dh, auth: keys.auth };
  await db.pushSubscription.upsert({ where: { endpoint }, create: { endpoint, ...data }, update: data });
  const res = NextResponse.json({ ok: true });
  // Lets logging out stop this device's notifications (see logOut).
  res.cookies.set(PUSH_COOKIE, endpoint, { httpOnly: true, secure: req.nextUrl.protocol === "https:", sameSite: "lax", path: "/", maxAge: 365 * 24 * 60 * 60 });
  return res;
}

/** Turns notifications off for this browser. */
export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ error: "signedOut" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { endpoint?: unknown } | null;
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : req.cookies.get(PUSH_COOKIE)?.value;
  if (endpoint) await db.pushSubscription.deleteMany({ where: { endpoint, userId: session.user.id } });
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(PUSH_COOKIE);
  return res;
}
