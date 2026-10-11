import { auth } from "@/auth";
import { openLogStream } from "@/lib/agent";
import { getOwnedServer } from "@/lib/servers";

// Proxies the agent's console stream to the browser, after checking ownership.
// The agent token never leaves the server.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const server = await getOwnedServer(id, session.user.id);
  if (!server) return new Response("Not found", { status: 404 });

  try {
    const upstream = await openLogStream(server.id, req.signal);
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch {
    return new Response("Console unavailable", { status: 502 });
  }
}
