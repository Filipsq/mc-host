import { randomUUID } from "node:crypto";
import type { Server } from "@prisma/client";
import { db } from "./db";
import { applyToHost, javaHost } from "./servers";

// Linked servers: an owner's Java servers that players move between in the
// game, without a proxy. Minecraft 1.20.5 added the transfer command, which
// sends a player's game to another address; the agent gives each linked
// server a small data pack (agent/links.go) so anyone can type
// /trigger <name> (or click the name in chat) to go there. Each server keeps
// its own world, inventory, plugins and payment; players land on the other
// one as if they had typed its address.

/** Most servers in one group. */
export const LINKS_MAX = 6;

/** Whether the server's Minecraft has the transfer command (Java 1.20.5 or newer, or the newest). */
export function canLink(s: Pick<Server, "edition" | "version">) {
  if (s.edition !== "JAVA") return false;
  const m = s.version.match(/^1\.(\d+)(?:\.(\d+))?$/);
  if (!m) return true; // LATEST, 26.x and on
  const minor = Number(m[1]);
  return minor > 20 || (minor === 20 && Number(m[2] ?? 0) >= 5);
}

/** The name players type after /trigger to go to this server: its address's first part. */
export function linkName(s: Pick<Server, "subdomain">) {
  return (s.subdomain ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "_").slice(0, 32);
}

/** The other servers this one sends players to, as the agent gets them. */
export function linkEntries(others: Pick<Server, "subdomain">[]) {
  return others.filter((o) => o.subdomain).map((o) => `${linkName(o)}=${javaHost(o)}`);
}

/**
 * Puts `serverId` in one group with `others` (the same owner's servers; none
 * takes it out of its group). Servers that leave a group, and the group they
 * leave behind, are updated too, and every server whose list changed is rebuilt
 * (a running one restarts). Returns how many servers were rebuilt.
 */
export async function setLinks(ownerId: string, serverId: string, otherIds: string[]) {
  const owned = await db.server.findMany({ where: { ownerId } });
  const self = owned.find((s) => s.id === serverId);
  if (!self || !canLink(self)) throw new Error("server can't be linked");
  const picked = owned.filter((s) => s.id !== serverId && otherIds.includes(s.id) && canLink(s)).slice(0, LINKS_MAX - 1);

  // Every group these servers were in before, so the ones staying behind are updated as well.
  const before = new Set([self, ...picked].map((s) => s.linkGroup).filter((g): g is string => !!g));
  const chosen = new Set([serverId, ...picked.map((s) => s.id)]);
  // The same group again keeps its name; any other pick makes a new one, so servers left
  // behind in an old group never end up in it by its name.
  const same = !!self.linkGroup && owned.every((s) => s.linkGroup !== self.linkGroup || chosen.has(s.id));
  const group = picked.length ? (same ? self.linkGroup : randomUUID()) : null;
  const members = new Map<string, string | null>();
  for (const s of owned) members.set(s.id, chosen.has(s.id) ? group : s.linkGroup);
  // A group left with one server is no group.
  for (const g of before) {
    const left = owned.filter((s) => members.get(s.id) === g);
    if (left.length === 1) members.set(left[0].id, null);
  }

  let rebuilt = 0;
  for (const s of owned) {
    const g = members.get(s.id) ?? null;
    const links = g ? linkEntries(owned.filter((o) => o.id !== s.id && members.get(o.id) === g)) : [];
    const changed = links.join("\n") !== s.links.join("\n");
    if (g === s.linkGroup && !changed) continue;
    const updated = await db.server.update({ where: { id: s.id }, data: { linkGroup: g, links } });
    if (!changed) continue;
    try {
      await applyToHost(updated);
      if (updated.status === "RUNNING") rebuilt++;
    } catch (err) {
      // It gets the list on its next rebuild (Settings > Zapisz, a move, a plan change).
      console.error("apply links failed", s.id, err);
    }
  }
  return rebuilt;
}
