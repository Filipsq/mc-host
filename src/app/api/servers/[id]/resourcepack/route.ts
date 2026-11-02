import { getSession } from "@/lib/session";
import { writeFile } from "@/lib/agent";
import { getServerFor } from "@/lib/access";
import { canChangeFiles, fileError } from "@/lib/files";
import { PACK_FILE, PACK_MAX_BYTES } from "@/lib/resourcePack";

// The resource pack page's "upload a file": the .zip is streamed into the
// server's own files (PACK_FILE). Saving the form then checks it and gives
// players the link to it (resourcepack/actions.ts).

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // Only the panel's own pages may upload (browsers send Origin with XHR).
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return Response.json({ error: "uploadFailed" }, { status: 403 });
  const session = await getSession();
  if (!session?.user?.id) return Response.json({ error: "uploadFailed" }, { status: 401 });
  const { id } = await params;
  const server = await getServerFor(id, session.user.id, "settings");
  if (!server || server.edition !== "JAVA" || !req.body) return Response.json({ error: "uploadFailed" }, { status: 404 });
  if (!canChangeFiles(server)) return Response.json({ error: "readOnly" }, { status: 403 });
  const length = Number(req.headers.get("content-length") ?? NaN);
  if (!Number.isFinite(length) || length <= 0) return Response.json({ error: "uploadFailed" }, { status: 411 });
  if (length > PACK_MAX_BYTES) return Response.json({ error: "tooBig" }, { status: 413 });
  try {
    await writeFile(server.id, PACK_FILE, req.body, length);
    return Response.json({ ok: true });
  } catch (err) {
    const error = fileError(err);
    return Response.json({ error: error === "quota" || error === "noSpace" ? "noSpace" : error === "tooBig" ? "tooBig" : "uploadFailed" }, { status: 400 });
  }
}
