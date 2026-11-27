import { readLogTail } from "@/lib/agent";
import { serverForDeployKey } from "@/lib/deployKey";

// For scripts with a deploy key (src/lib/deployKey.ts): the console's last 200 lines, to see
// whether the new plugins loaded. Plain text, one line per line.
export async function GET(req: Request) {
  const server = await serverForDeployKey(req);
  if (!server) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const lines = await readLogTail(server.id);
    return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
