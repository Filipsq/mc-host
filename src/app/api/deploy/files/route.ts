import { changeFiles, writeFile } from "@/lib/agent";
import { isDeployPath, serverForDeployKey } from "@/lib/deployKey";
import { fileError } from "@/lib/files";
import { logServerEvent } from "@/lib/serverEvents";

// For scripts with a deploy key (src/lib/deployKey.ts): PUT puts the body in a file in plugins/,
// DELETE removes one (an old jar under another name). ?path=plugins/MchostingCore.jar

/** Biggest file a deploy may send (plugins are a few MB). */
const MAX_BYTES = 64 * 1024 * 1024;

async function target(req: Request) {
  const server = await serverForDeployKey(req);
  if (!server) return { error: Response.json({ error: "unauthorized" }, { status: 401 }) };
  const path = new URL(req.url).searchParams.get("path") ?? "";
  if (!isDeployPath(path)) return { error: Response.json({ error: "badPath" }, { status: 400 }) };
  return { server, path };
}

export async function PUT(req: Request) {
  const found = await target(req);
  if ("error" in found) return found.error;
  const length = Number(req.headers.get("content-length") ?? NaN);
  if (!req.body || !Number.isFinite(length)) return Response.json({ error: "lengthRequired" }, { status: 411 });
  if (length > MAX_BYTES) return Response.json({ error: "tooBig" }, { status: 413 });
  try {
    await writeFile(found.server.id, found.path, req.body, length);
  } catch (err) {
    return Response.json({ error: fileError(err) }, { status: 400 });
  }
  // One line per 10 minutes, so a deploy of several jars is one line on the history.
  await logServerEvent(found.server, "fileUpload", "klucz do wgrywania: plugins", { system: true, ref: `deploy@${Math.floor(Date.now() / 600_000)}` });
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const found = await target(req);
  if ("error" in found) return found.error;
  try {
    await changeFiles(found.server.id, { remove: found.path });
  } catch (err) {
    const error = fileError(err);
    // Already gone is what the script wanted.
    if (error === "notFound") return Response.json({ ok: true });
    return Response.json({ error }, { status: 400 });
  }
  return Response.json({ ok: true });
}
