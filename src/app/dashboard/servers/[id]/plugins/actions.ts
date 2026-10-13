"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Server } from "@prisma/client";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import * as agent from "@/lib/agent";
import { agentSpec } from "@/lib/servers";
import { getServerFor } from "@/lib/access";
import { getAddon } from "@/lib/modrinth";
import { GAME_MODE_PLUGINS, PLUGINS_MAX, PLUGIN_SETS, addonType, isProjectId, pluginIds, setFits } from "@/lib/plugins";
import type { Messages } from "@/i18n/messages";

export type PluginResult = { error?: keyof Messages["plugins"]["errors"]; pending?: boolean };

/** The server, if the user may change its plugins (Paper) or mods (a mod loader). */
async function addonServer(id: string) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const server = await getServerFor(id, session.user.id, "plugins");
  const type = server && addonType(server);
  return server && type ? { ...server, type } : null;
}

/** Adds a Modrinth plugin or mod (by project ID, as search results give it) to the server. */
export async function addPluginAction(id: string, projectId: string): Promise<PluginResult> {
  const server = await addonServer(id);
  if (!server || !isProjectId(projectId)) return { error: "failed" };
  if (server.plugins.includes(projectId)) return {};
  if (server.plugins.length >= PLUGINS_MAX) return { error: "tooMany" };
  const plugin = await getAddon(projectId, server.type, server.kind);
  if (typeof plugin === "string") return { error: plugin };
  // The game mode's own plugins are always there.
  if ((GAME_MODE_PLUGINS[server.kind] ?? []).some((p) => p.slug === plugin.slug)) return {};
  return savePlugins(server, [...server.plugins, plugin.id]);
}

/** Adds the plugins of a ready set that the server doesn't have yet. */
export async function addPluginSetAction(id: string, setId: string): Promise<PluginResult> {
  const server = await addonServer(id);
  const set = PLUGIN_SETS.find((s) => s.id === setId);
  if (!server || server.type !== "plugin" || !set || !setFits(set, server.kind)) return { error: "failed" };
  const missing = pluginIds(set.plugins).filter((p) => !server.plugins.includes(p));
  if (missing.length === 0) return {};
  if (server.plugins.length + missing.length > PLUGINS_MAX) return { error: "tooMany" };
  return savePlugins(server, [...server.plugins, ...missing]);
}

export async function removePluginAction(id: string, projectId: string): Promise<PluginResult> {
  const server = await addonServer(id);
  if (!server) return { error: "failed" };
  return savePlugins(
    server,
    server.plugins.filter((p) => p !== projectId),
  );
}

/** Rebuilds the server with its plugin list now; a running server restarts. */
export async function applyPluginsAction(id: string): Promise<PluginResult> {
  const server = await addonServer(id);
  if (!server) return { error: "failed" };
  try {
    await agent.recreateServer(agentSpec(server), { keepStopped: true });
  } catch (err) {
    console.error("apply plugins failed", server.id, err);
    return { error: "applyFailed", pending: true };
  }
  await db.server.update({ where: { id: server.id }, data: { pluginsPending: false } });
  revalidatePath(`/dashboard/servers/${id}`, "layout");
  return {};
}

/**
 * Saves the list. A server that's off gets it right away (its next start
 * installs them); a running one keeps playing until its owner restarts it.
 */
async function savePlugins(server: Server, plugins: string[]): Promise<PluginResult> {
  const updated = await db.server.update({ where: { id: server.id }, data: { plugins } });
  revalidatePath(`/dashboard/servers/${server.id}`, "layout");
  // Not on the game host (unpaid): the list is used when it's created again.
  if (!["RUNNING", "STOPPED", "SLEEPING"].includes(server.status)) return {};
  let running = true;
  try {
    const state = await agent.getServerState(server.id);
    running = state.state === "running" || state.state === "restarting";
    if (!running) await agent.recreateServer(agentSpec(updated), { keepStopped: true });
  } catch (err) {
    console.error("apply plugins failed", server.id, err);
  }
  await db.server.update({ where: { id: server.id }, data: { pluginsPending: running } });
  return { pending: running };
}
