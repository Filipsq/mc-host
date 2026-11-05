import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { START_PACK_COOKIE, startPackQuery } from "@/lib/startPack";

// A mod pack's "Utwórz serwer" on the home page: signed in, straight to the create
// page with the pack picked; signed out, to sign-up, keeping the pack for after.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const value = params.get("cf") ? `cf:${params.get("cf")}` : `pack:${params.get("pack") ?? ""}`;
  const query = startPackQuery(value);
  const session = await getSession();
  if (session?.user?.id) return NextResponse.redirect(new URL(query ? `/dashboard/new?${query}` : "/dashboard/new", req.url));
  const res = NextResponse.redirect(new URL("/signup", req.url));
  if (query) res.cookies.set(START_PACK_COOKIE, value, { httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24, path: "/" });
  return res;
}
