import "server-only";
import { logServerEvent } from "./serverEvents";
import { db } from "./db";
import * as agent from "./agent";
import { agentSpec, startElsewhere } from "./servers";
import { sendPush } from "./push";
import { messages, format } from "@/i18n/messages";
import { defaultLocale, isLocale } from "@/i18n/config";

// A free server that finds no room when started waits in line (Server.queuedAt)
// instead of being turned away: the panel tries again while its owner looks, and
// this job every few minutes, oldest first, telling the owner once it runs.

/** After this long nobody is waiting any more: the server leaves the line. */
export const QUEUE_HOURS = 3;

/** Starts the waiting free servers that now have room. Returns how many started. */
export async function startQueued(now = new Date()): Promise<number> {
  await db.server.updateMany({
    where: {
      queuedAt: { lt: new Date(now.getTime() - QUEUE_HOURS * 60 * 60 * 1000) },
    },
    data: { queuedAt: null },
  });
  const waiting = await db.server.findMany({
    where: { queuedAt: { not: null } },
    orderBy: { queuedAt: "asc" },
    include: { owner: { select: { locale: true } } },
  });
  // A machine that turned one away has no room for those behind it either.
  const full = new Set<string>();
  let started = 0;
  for (const s of waiting) {
    if (s.plan !== "FREE" || s.status !== "STOPPED") {
      await db.server.updateMany({
        where: { id: s.id },
        data: { queuedAt: null },
      });
      continue;
    }
    if (full.has(s.node)) continue;
    try {
      if (s.pluginsPending || s.edition === "HYTALE")
        await agent.recreateServer(agentSpec(s));
      else
        await agent.startServer(s.id).catch(async (err) => {
          if (!(err instanceof agent.AgentError && err.status === 404))
            throw err;
          await agent.recreateServer(agentSpec(s));
        });
    } catch (err) {
      if (agent.isFull(err)) {
        // Another machine may really have room now: it moves there and starts.
        if (!(await startElsewhere(s).catch(() => null))) {
          full.add(s.node);
          continue;
        }
      } else {
        // Something else is wrong with it: its owner sees why on clicking Start.
        console.error("queued server not started", s.id, err);
        await db.server.updateMany({
          where: { id: s.id },
          data: { queuedAt: null },
        });
        continue;
      }
    }
    // Unless its owner started or left the line meanwhile.
    const claim = await db.server.updateMany({
      where: { id: s.id, queuedAt: { not: null } },
      data: { status: "RUNNING", pluginsPending: false, queuedAt: null },
    });
    if (claim.count === 0) continue;
    started++;
    await logServerEvent(s, "queueStart", s.node, { system: true });
    const t =
      messages[isLocale(s.owner.locale) ? s.owner.locale : defaultLocale].server
        .queue;
    await sendPush([s.ownerId], {
      title: t.pushTitle,
      body: format(t.pushBody, { server: s.name }),
      url: `/dashboard/servers/${s.id}`,
    });
  }
  return started;
}

/**
 * Where a waiting server stands: how many free servers wait in all, and its own
 * place (1 = next to start). Shown in the queue window on its panel.
 */
export async function queuePlace(queuedAt: Date) {
  const where = { queuedAt: { not: null }, plan: "FREE", status: "STOPPED" } as const;
  const [waiting, ahead] = await Promise.all([
    db.server.count({ where }),
    db.server.count({ where: { ...where, queuedAt: { lt: queuedAt } } }),
  ]);
  return { waiting: Math.max(waiting, ahead + 1), place: ahead + 1 };
}
