import { getSession } from "@/lib/session";
import { openFile, writeFile } from "@/lib/agent";
import { getServerFor } from "@/lib/access";
import { fileError, canChangeFiles } from "@/lib/files";

// Downloads and uploads for the file manager, streamed between the browser
// and the agent after checking that the user may use the server's files.

async function ownedServer(req: Request, params: Promise<{ id: string }>) {
  const session = await getSession();
  if (!session?.user?.id) return null;
  const { id } = await params;
  const path = new URL(req.url).searchParams.get("path") ?? "";
  const server = await getServerFor(id, session.user.id, "files");
  return server && path && path.length <= 1024 ? { server, path } : null;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const found = await ownedServer(req, params);
  if (!found) return new Response("Not found", { status: 404 });
  try {
    const upstream = await openFile(found.server.id, found.path, { signal: req.signal });
    const name = found.path.split("/").filter(Boolean).at(-1) ?? "file";
    const headers = new Headers({
      "Content-Type": "application/octet-stream",
      // The ASCII name for old browsers, the real one for the rest.
      "Content-Disposition": `attachment; filename="${name.replace(/[^\w.-]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    const length = upstream.headers.get("Content-Length");
    if (length) headers.set("Content-Length", length);
    return new Response(upstream.body, { headers });
  } catch (err) {
    const error = fileError(err);
    return new Response(error, { status: error === "notFound" ? 404 : 502 });
  }
}

/** Saves the request body as the file: an upload, or an edit from the editor. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // Only the panel's own pages may write (browsers send Origin with fetch and XHR).
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return Response.json({ error: "failed" }, { status: 403 });
  const found = await ownedServer(req, params);
  if (!found || !req.body) return Response.json({ error: "notFound" }, { status: 404 });
  if (!canChangeFiles(found.server)) return Response.json({ error: "readOnly" }, { status: 403 });
  const length = Number(req.headers.get("content-length") ?? NaN);
  try {
    await writeFile(found.server.id, found.path, req.body, Number.isFinite(length) ? length : undefined);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: fileError(err) }, { status: 400 });
  }
}
