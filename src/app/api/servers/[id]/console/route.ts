import { getSession } from "@/lib/session";
import { openLogStream } from "@/lib/agent";
import { getServerFor } from "@/lib/access";

// Proxies the agent's console stream to the browser, after checking the user may use the console.
// The agent token never leaves the server.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const server = await getServerFor(id, session.user.id, "console");
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
