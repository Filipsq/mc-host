import { NextResponse } from "next/server";
import { adminOnline } from "@/lib/presence";

export const dynamic = "force-dynamic";

/** Polled by the help bubble, also for signed-out visitors: is an admin on the site now? */
export async function GET() {
  return NextResponse.json({ online: adminOnline() }, { headers: { "cache-control": "no-store" } });
}
