import { restartForDeploy, serverForDeployKey } from "@/lib/deployKey";
import { logServerEvent } from "@/lib/serverEvents";

// For scripts with a deploy key (src/lib/deployKey.ts): restarts the server so it loads new plugins.
export async function POST(req: Request) {
  const server = await serverForDeployKey(req);
  if (!server) return Response.json({ error: "unauthorized" }, { status: 401 });
  const result = await restartForDeploy(server);
  if (result.error) {
    await logServerEvent(server, "startFailed", `klucz do wgrywania: ${result.error}`, { system: true });
    return Response.json(result, { status: 503 });
  }
  await logServerEvent(server, "restart", "klucz do wgrywania", { system: true });
  return Response.json({ ok: true });
}
