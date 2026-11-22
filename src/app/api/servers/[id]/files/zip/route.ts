import { getSession } from "@/lib/session";
import { openFilesZip } from "@/lib/agent";
import { getServerFor } from "@/lib/access";
import { fileError } from "@/lib/files";

// Downloads the files and folders ticked in the file manager as one zip,
// streamed from the agent. The page posts a form, so the browser saves the
// zip as it comes; if it can't start, the page opens again with the error.

// A folder listing shows at most 5000 entries, so "select all" never sends more.
const MAX_PATHS = 5000;
const okPath = (p: unknown): p is string => typeof p === "string" && p.length > 0 && p.length <= 1024 && !p.includes("\0");

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // Only the panel's own pages may ask (browsers send Origin with form posts).
  const origin = req.headers.get("origin");
  if (origin && URL.parse(origin)?.host !== req.headers.get("host")) return new Response("Forbidden", { status: 403 });
  const session = await getSession();
  if (!session?.user?.id) return new Response(null, { status: 303, headers: { Location: "/login" } });
  const { id } = await params;
  const server = await getServerFor(id, session.user.id, "files");
  if (!server) return new Response("Not found", { status: 404 });

  const form = await req.formData().catch(() => null);
  const dir = String(form?.get("dir") ?? "").slice(0, 1024);
  const back = (error: string) =>
    new Response(null, {
      status: 303,
      headers: { Location: `/dashboard/servers/${server.id}/files?${new URLSearchParams({ ...(dir && { path: dir }), zip: error })}` },
    });
  let paths: unknown;
  try {
    paths = JSON.parse(String(form?.get("paths") ?? ""));
  } catch {
    return back("badName");
  }
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_PATHS || !paths.every(okPath)) return back("badName");

  try {
    const upstream = await openFilesZip(server.id, paths, req.signal);
    const file = `${zipName(paths, dir, server.name)}.zip`;
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
    return back(fileError(err));
  }
}

const baseName = (p: string) => p.split("/").filter(Boolean).at(-1) ?? "";

/** One thing ticked: its name; more: the folder they're in, or at the top the server's name. */
function zipName(paths: string[], dir: string, server: string) {
  const name = (paths.length === 1 ? baseName(paths[0]) : baseName(dir)) || server.trim() || "pliki";
  return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 100);
}
