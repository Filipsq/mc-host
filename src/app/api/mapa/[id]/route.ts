import { db } from "@/lib/db";
import { getWorldMap } from "@/lib/agent";
import { activeLevel } from "@/lib/worlds";
import { validWorldMapLink } from "@/lib/worldMap";

// The world map an email links to (src/lib/worldMap.ts): no session, a signed link that ends.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const q = new URL(req.url).searchParams;
  if (!validWorldMapLink(id, q.get("e"), q.get("s"))) return new Response("Not found", { status: 404 });
  const server = await db.server.findUnique({ where: { id }, select: { id: true, edition: true, level: true } });
  if (!server || server.edition !== "JAVA") return new Response("Not found", { status: 404 });
  const png = await getWorldMap(server.id, activeLevel(server)).catch(() => null);
  if (!png) return new Response("Not found", { status: 404 });
  return new Response(png, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } });
}
