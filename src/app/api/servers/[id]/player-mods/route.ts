import { getSession } from "@/lib/session";
import { getServerFor } from "@/lib/access";
import { hasPlayerMods, playerModsResponse } from "@/lib/playerMods";

// The panel's "Mody dla graczy": ?f=mrpack or zip downloads the players' pack,
// ?f=list says what's in it (src/lib/playerMods.ts).

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const server = await getServerFor(id, session.user.id, "plugins");
  if (!server || !hasPlayerMods(server) || server.status === "AWAITING_PAYMENT") return new Response("Not found", { status: 404 });
  return playerModsResponse(server, new URL(req.url).searchParams.get("f"), req.signal);
}
