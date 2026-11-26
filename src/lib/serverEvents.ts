import "server-only";
import type { Server } from "@prisma/client";
import { auth } from "@/auth";
import { db } from "./db";

// A server's history for admins (Fiq asked 2026-11-26): the chat with a customer and
// the admin server page show what happened to each server (type and version changes,
// starts, crashes, plugins, worlds, files, payments) without opening its panel.
// Logging never fails the action it records: errors are only printed.

export const EVENT_KINDS = [
  "created",
  "type",
  "version",
  "undo",
  "settings",
  "rename",
  "start",
  "stop",
  "restart",
  "startFailed",
  "queued",
  "queueStart",
  "crash",
  "repair",
  "pluginAdd",
  "pluginRemove",
  "worldSwitch",
  "worldNew",
  "worldImport",
  "worldDelete",
  "worldTrim",
  "backup",
  "restore",
  "fileEdit",
  "fileDelete",
  "fileRename",
  "fileUpload",
  "move",
  "suspended",
  "giftDays",
  "slots",
  "minigamesOn",
  "minigamesOff",
  "xboxOn",
  "xboxOff",
  "resourcePack",
  "domain",
  "friendAdd",
  "friendRemove",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export type EventActor = "owner" | "friend" | "admin" | "system";

/** Kinds that went wrong, shown in red. */
export const BAD_EVENTS: ReadonlySet<string> = new Set(["crash", "startFailed", "suspended"]);

type Who = { actor: EventActor; actorEmail: string | null };

/** Who is doing this: the signed-in user compared with the server's owner, or the system outside a request. */
async function who(server: Pick<Server, "ownerId">): Promise<Who> {
  try {
    const session = await auth();
    const id = session?.user?.id;
    if (!id) return { actor: "system", actorEmail: null };
    if (id === server.ownerId) return { actor: "owner", actorEmail: null };
    const user = await db.user.findUnique({ where: { id }, select: { email: true, admin: true } });
    if (!user) return { actor: "system", actorEmail: null };
    return { actor: user.admin ? "admin" : "friend", actorEmail: user.email };
  } catch {
    // Not in a request (billing job, agent callbacks): nobody signed in.
    return { actor: "system", actorEmail: null };
  }
}

const MAX_DETAIL = 300;

/** Records one event on the server's history. Never throws. */
export async function logServerEvent(
  server: Pick<Server, "id" | "ownerId">,
  kind: EventKind,
  detail = "",
  opts: { system?: boolean; ref?: string } = {},
) {
  try {
    const by: Who = opts.system ? { actor: "system", actorEmail: null } : await who(server);
    const data = { serverId: server.id, kind, detail: detail.slice(0, MAX_DETAIL), ref: opts.ref ?? null, ...by };
    // A ref makes it once only (a crash seen on every refresh).
    if (opts.ref) await db.serverEvent.createMany({ data: [data], skipDuplicates: true });
    else await db.serverEvent.create({ data });
  } catch (err) {
    console.error("server event not saved", server.id, kind, err);
  }
}

/** "1.21.4 → 1.21.8", or just the new value when the old one is the same. */
export const change = (from: string | null | undefined, to: string | null | undefined) => (from && from !== to ? `${from} → ${to ?? "–"}` : (to ?? ""));

/** What a Java server runs, briefly, for a history line: "fabric 1.21.1", "modpack Cobblemon 1.6". */
export function kindText(s: Pick<Server, "kind" | "version" | "modpackTitle" | "modpack" | "modpackVersion">) {
  if (s.kind === "modpack") return `modpack ${s.modpackTitle ?? s.modpack ?? ""}${s.modpackVersion ? ` ${s.modpackVersion}` : ""}`.trim();
  return `${s.kind === "vanilla" ? "paper" : s.kind} ${s.version === "LATEST" ? "najnowsza" : s.version}`;
}

export type HistoryEntry = {
  id: string;
  at: Date;
  kind: EventKind | "payment" | "upgrade" | "paymentGift";
  detail: string;
  actor: EventActor;
  actorEmail: string | null;
};

/**
 * A server's latest history, newest first: the logged events and its paid payments
 * (which are older than the log, so even old servers show their plan changes).
 */
export async function serverHistory(serverId: string, take = 15): Promise<HistoryEntry[]> {
  const [events, payments] = await Promise.all([
    db.serverEvent.findMany({ where: { serverId }, orderBy: { createdAt: "desc" }, take }),
    db.payment.findMany({
      where: { serverId, status: "PAID" },
      orderBy: { createdAt: "desc" },
      take,
      select: { id: true, plan: true, days: true, amount: true, currency: true, upgradeFrom: true, paidAt: true, createdAt: true, redeemedGiftId: true, addonsOnly: true, xboxDays: true, domainDays: true, renewal: true },
    }),
  ]);
  const list: HistoryEntry[] = events.map((e) => ({
    id: e.id,
    at: e.createdAt,
    kind: e.kind as EventKind,
    detail: e.detail,
    actor: e.actor as EventActor,
    actorEmail: e.actorEmail,
  }));
  for (const p of payments) {
    const money = p.amount > 0 ? `${(p.amount / 100).toFixed(2).replace(".", ",").replace(",00", "")} ${p.currency.toUpperCase() === "PLN" ? "zł" : p.currency.toUpperCase()}` : "";
    const what = p.upgradeFrom
      ? `${p.upgradeFrom} → ${p.plan}`
      : p.xboxDays
        ? `Xbox ${p.xboxDays} dni`
        : p.domainDays
          ? `domena ${p.domainDays} dni`
          : p.addonsOnly
            ? "dodatki"
            : `${p.plan} ${p.days} dni${p.renewal ? " (auto)" : ""}`;
    list.push({
      id: p.id,
      at: p.paidAt ?? p.createdAt,
      kind: p.upgradeFrom ? "upgrade" : p.redeemedGiftId ? "paymentGift" : "payment",
      detail: [what, money].filter(Boolean).join(" · "),
      actor: "owner",
      actorEmail: null,
    });
  }
  return list.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, take);
}

/** The history as text lines, for "Kopiuj dla Claude". */
export function historyText(list: HistoryEntry[]) {
  return list.map((e) => `  ${e.at.toISOString().slice(0, 16).replace("T", " ")} ${e.kind}${e.detail ? `: ${e.detail}` : ""}${e.actor !== "owner" ? ` (${e.actorEmail ?? e.actor})` : ""}`).join("\n");
}
