import { getSession } from "@/lib/session";
import { getMetrics } from "@/lib/agent";
import { getServerFor } from "@/lib/access";

// The Statistics card's numbers, for anyone who may see the server.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const server = await getServerFor(id, session.user.id, "view");
  if (!server) return new Response("Not found", { status: 404 });

  const range = new URL(req.url).searchParams.get("range") === "day" ? "day" : "hour";
  try {
    return Response.json(await getMetrics(server.id, range), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return new Response("Statistics unavailable", { status: 502 });
  }
}
