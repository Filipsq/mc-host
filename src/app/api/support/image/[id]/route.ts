import { getSession } from "@/lib/session";
import { isAdmin } from "@/lib/admin";
import { readImage } from "@/lib/support";

export const dynamic = "force-dynamic";

/**
 * A chat picture, only for the chat's user and the admins. The headers make
 * the browser treat it strictly as a picture, so even a disguised file can't
 * run anything on the site.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const { id } = await params;
  const image = session?.user?.id ? await readImage(id, session.user.id, await isAdmin(session.user.id)) : null;
  if (!image) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(image.data), {
    headers: {
      "Content-Type": image.type,
      "Content-Length": String(image.size),
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
