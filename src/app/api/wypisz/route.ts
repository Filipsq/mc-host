import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { checkUnsubscribe } from "@/lib/comeback";

export const dynamic = "force-dynamic";

// The unsubscribe link in "come back and play" emails. Opening it shows a page
// with a button (link checkers that open every link mustn't unsubscribe anyone);
// mail apps' own unsubscribe button POSTs here and turns them off at once.

export function GET(req: NextRequest) {
  const url = new URL("/wypisz", req.nextUrl);
  url.search = req.nextUrl.search;
  return NextResponse.redirect(url, 303);
}

export async function POST(req: NextRequest) {
  const u = req.nextUrl.searchParams.get("u");
  if (!checkUnsubscribe(u, req.nextUrl.searchParams.get("t"))) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  await db.user.updateMany({ where: { id: u }, data: { comebackOff: true } });
  return NextResponse.json({ ok: true });
}
