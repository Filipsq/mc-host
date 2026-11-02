import { db } from "@/lib/db";
import { openFile } from "@/lib/agent";
import { PACK_FILE, isUploadedPack } from "@/lib/resourcePack";

// Where players' games download a resource pack the owner uploaded
// (src/lib/resourcePack.ts). Public: Minecraft fetches it without signing in.
// The SHA-1 in the address must be the saved pack's, so an old address stops
// working once the pack changes and each address always gives the same file.

export async function GET(req: Request, { params }: { params: Promise<{ id: string; file: string }> }) {
  const { id, file } = await params;
  const sha1 = /^([0-9a-f]{40})\.zip$/.exec(file)?.[1];
  if (!sha1 || id.length > 64) return new Response("Not found", { status: 404 });
  const server = await db.server.findUnique({ where: { id }, select: { id: true, resourcePack: true, resourcePackSha1: true } });
  if (!server || server.resourcePackSha1 !== sha1 || !isUploadedPack(server.resourcePack)) return new Response("Not found", { status: 404 });
  try {
    const upstream = await openFile(server.id, PACK_FILE, { signal: req.signal });
    const headers = new Headers({
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="resourcepack.zip"',
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
    const length = upstream.headers.get("Content-Length");
    if (length) headers.set("Content-Length", length);
    return new Response(upstream.body, { headers });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
