import { getSession } from "@/lib/session";
import { AgentError, openBackupDownload } from "@/lib/agent";
import { getOwnedServer } from "@/lib/servers";

// Streams a backup from the agent to the browser, after checking ownership.
export async function GET(req: Request, { params }: { params: Promise<{ id: string; name: string }> }) {
  const session = await getSession();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });

  const { id, name } = await params;
  const server = await getOwnedServer(id, session.user.id);
  if (!server || !/^\d{8}-\d{6}\.tar\.gz$/.test(name)) return new Response("Not found", { status: 404 });

  try {
    const upstream = await openBackupDownload(server.id, name, req.signal);
    const headers = new Headers({
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${server.subdomain ?? server.edition.toLowerCase()}-${name}"`,
      "Cache-Control": "private, no-store",
    });
    const length = upstream.headers.get("Content-Length");
    if (length) headers.set("Content-Length", length);
    return new Response(upstream.body, { headers });
  } catch (err) {
    if (err instanceof AgentError && err.status === 404) return new Response("Not found", { status: 404 });
    return new Response("Backup unavailable", { status: 502 });
  }
}
