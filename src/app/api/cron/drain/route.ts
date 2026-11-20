import { sameSecret } from "@/lib/sameSecret";
import { db } from "@/lib/db";
import { rankNodes } from "@/lib/capacity";
import { applyToHost, moveServer } from "@/lib/servers";
import { requiredArch } from "@/lib/terraria";
import { MAIN_NODE, nodes } from "@/lib/nodes";

// Moves every server off one machine, one at a time, before it's taken out of use
// (deploy/remove-node.sh runs it). Each goes where a new server like it would, stopped;
// its owner starts it again as usual. Prints a line per server as it goes.
export const maxDuration = 21600; // six hours: Next.js reads it as a plain number

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !sameSecret(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const from = new URL(req.url).searchParams.get("node");
  if (!from || from === MAIN_NODE || !nodes().some((n) => n.id === from)) {
    return new Response("Give ?node=<an extra machine's id>\n", { status: 400 });
  }
  const servers = await db.server.findMany({ where: { node: from }, orderBy: { createdAt: "asc" } });
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(out) {
      const say = (line: string) => out.enqueue(encoder.encode(line + "\n"));
      say(`${servers.length} servers on ${from}`);
      let moved = 0;
      for (const [i, server] of servers.entries()) {
        const paid = server.plan !== "FREE";
        const to = (await rankNodes(server.memoryMb, paid ? server.memoryMb : 0, undefined, requiredArch(server))).find((n) => n !== from);
        const label = `${i + 1}/${servers.length} ${server.name}`;
        if (!to) {
          say(`${label}: no machine has room, left on ${from}`);
          continue;
        }
        try {
          const done = await moveServer(server, to);
          if (!done) throw new Error("copy failed");
          const stopped = done.status === "RUNNING" ? await db.server.update({ where: { id: done.id }, data: { status: "STOPPED" } }) : done;
          await applyToHost(stopped).catch((err) => console.error("drain: container not built", done.id, err));
          moved++;
          say(`${label}: moved to ${to}`);
        } catch (err) {
          say(`${label}: FAILED (${err instanceof Error ? err.message : err}), left on ${from}`);
        }
      }
      say(`Done: ${moved} of ${servers.length} moved.`);
      out.close();
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
