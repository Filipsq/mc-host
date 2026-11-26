import { getSession } from "@/lib/session";
import { getServerFor } from "@/lib/access";
import { getWorldMap } from "@/lib/agent";
import { isKnownWorldName } from "@/lib/worlds";

// A Java world from above for the panel (Światy): GET ?name=world.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.id) return new Response("Not found", { status: 404 });
  const { id } = await params;
  const name = new URL(req.url).searchParams.get("name") ?? "";
  const server = await getServerFor(id, session.user.id, "view");
  if (!server || server.edition !== "JAVA" || !isKnownWorldName(name)) return new Response("Not found", { status: 404 });
  const png = await getWorldMap(server.id, name, 512).catch(() => null);
  if (!png) return new Response("Not found", { status: 404 });
  return new Response(png, { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=600" } });
}
