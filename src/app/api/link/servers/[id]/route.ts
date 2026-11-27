import { db } from "@/lib/db";
import { hubLinkOn } from "@/lib/hubLink";
import { javaHost } from "@/lib/servers";

// For the mchosting.pl hub (Filipsq/mc-server, ReturnDirectory): where a server with the hub link
// is and the public key its return tickets are signed with, so /wroc can send players back
// (src/lib/hubLink.ts). Public on purpose: the address is what players type anyway and the key
// only checks signatures. 404 for any server without the link, so nothing else can be probed.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return notFound();
  const server = await db.server.findUnique({
    where: { id },
    select: { name: true, edition: true, kind: true, version: true, status: true, subdomain: true, hubLink: true, hubLinkPrivateKey: true, hubLinkPublicKey: true },
  });
  if (!server || !server.subdomain || !server.hubLinkPublicKey || !hubLinkOn(server) || server.status === "SUSPENDED") return notFound();
  return Response.json(
    { name: server.name, host: javaHost(server), port: 25565, publicKey: server.hubLinkPublicKey },
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
}

function notFound() {
  return Response.json({ error: "not found" }, { status: 404, headers: { "Cache-Control": "public, max-age=60" } });
}
