import { iconPath, USER_AGENT } from "@/lib/modrinth";

// Plugin icons from Modrinth's CDN, passed through our server so that
// visitors' browsers don't contact a third party just by opening the page.

const CDN = () => process.env.MODRINTH_CDN_URL ?? "https://cdn.modrinth.com";
const TYPES = ["image/png", "image/webp", "image/jpeg", "image/gif"];

export async function GET(req: Request) {
  const path = iconPath(new URL(req.url).searchParams.get("src") ?? "");
  if (!path) return new Response("Not found", { status: 404 });
  try {
    const res = await fetch(CDN() + path, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const type = res.headers.get("content-type")?.split(";")[0] ?? "";
    const body = res.ok && TYPES.includes(type) ? await res.arrayBuffer() : null;
    if (!body || body.byteLength > 512 * 1024) return new Response("Not found", { status: 404 });
    return new Response(body, {
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, max-age=604800",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'",
      },
    });
  } catch {
    return new Response("Unavailable", { status: 502 });
  }
}
