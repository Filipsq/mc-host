import { getSession } from "@/lib/session";
import { openWorldDownload } from "@/lib/agent";
import { getServerFor } from "@/lib/access";
import { fileError } from "@/lib/files";
import { isKnownWorldName } from "@/lib/worlds";

// Downloads a world as a zip (Java) or .mcworld (Bedrock), streamed from the agent.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.id) return new Response("Not found", { status: 404 });
  const { id } = await params;
  const name = new URL(req.url).searchParams.get("name") ?? "";
  const server = await getServerFor(id, session.user.id, "files");
  if (!server || !isKnownWorldName(name)) return new Response("Not found", { status: 404 });
  try {
    const upstream = await openWorldDownload(server.id, server.edition, name, req.signal);
    const file = `${name}.${server.edition === "JAVA" ? "zip" : "mcworld"}`;
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "application/zip",
        // The ASCII name for old browsers, the real one for the rest.
        "Content-Disposition": `attachment; filename="${file.replace(/[^\w.-]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(file)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    const error = fileError(err);
    return new Response(error, { status: error === "notFound" ? 404 : 502 });
  }
}
