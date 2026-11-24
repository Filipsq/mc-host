import { db } from "@/lib/db";
import { clientIp, hit, isLimited } from "@/lib/rateLimit";
import { hasPlayerMods, playerModsOpen, playerModsResponse } from "@/lib/playerMods";

// The players' link (/mody/<token>): ?f=mrpack or zip. Public, so players
// download without an account; the owner can make a new link or turn it off.

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[\w-]{10,40}$/.test(token)) return new Response("Not found", { status: 404 });
  const what = new URL(req.url).searchParams.get("f");
  if (what !== "mrpack" && what !== "zip" && what !== "list") return new Response("Not found", { status: 404 });
  // The ZIP streams every jar from the game machine: a few per address per hour is plenty.
  const key = `player-mods:${clientIp(req.headers)}`;
  if (what !== "list") {
    if (isLimited(key, 20, 60 * 60_000)) return new Response("Too many downloads, try again later.", { status: 429 });
    hit(key);
  }
  const server = await db.server.findUnique({ where: { playerModsToken: token } });
  if (!server || !hasPlayerMods(server) || !playerModsOpen(server)) return new Response("Not found", { status: 404 });
  return playerModsResponse(server, what, req.signal);
}
