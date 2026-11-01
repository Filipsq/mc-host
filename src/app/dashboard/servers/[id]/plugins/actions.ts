"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Server } from "@prisma/client";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import * as agent from "@/lib/agent";
import { agentSpec } from "@/lib/servers";
import { getServerFor } from "@/lib/access";
import { PAPER_INSTALL_LOADERS, getAddon, projectsWithoutBuild } from "@/lib/modrinth";
import { downloadVersion, versionsToCheck } from "@/lib/addonVersions";
import { curseforgeModId, pinCurseforgeMods } from "@/lib/curseforge";
import { apiTooNew, downloadSitePlugin, pluginApiVersion, sitePluginFromLink } from "@/lib/sitePlugins";
import { canChangeFiles } from "@/lib/files";
import {
  GAME_MODE_PLUGINS,
  PLUGINS_MAX,
  PLUGIN_SETS,
  addonType,
  curseforgeEntry,
  curseforgeMod,
  isProjectId,
  pluginIds,
  setFits,
  sitePlugin,
  sitePluginFile,
} from "@/lib/plugins";
import { POPULAR_TMOD_MODS, parseWorkshopInput } from "@/lib/terraria";
import { resolveWorkshopItem } from "@/lib/steam";
import type { Messages } from "@/i18n/messages";

export type PluginResult = { error?: keyof Messages["plugins"]["errors"]; name?: string; version?: string; pending?: boolean };

/** Of these Modrinth projects, the ones with no build for the Minecraft the server runs (none when that isn't known). */
async function withoutBuild(server: Server & { type: string }, ids: string[]) {
  const versions = await versionsToCheck(server.kind, server.version);
  if (!versions) return { missing: [] as string[], version: "" };
  const loaders = server.type === "plugin" ? PAPER_INSTALL_LOADERS : [server.kind];
  return { missing: await projectsWithoutBuild(ids, loaders, versions), version: downloadVersion(versions) };
}

/** The server, if the user may change its plugins (Paper) or mods (a mod loader). */
async function addonServer(id: string) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const server = await getServerFor(id, session.user.id, "plugins");
  const type = server && addonType(server);
  return server && type ? { ...server, type } : null;
}

/** Adds a Modrinth plugin or mod (by project ID, as search results give it), or a popular tModLoader mod, to the server. */
export async function addPluginAction(id: string, projectId: string): Promise<PluginResult> {
  const server = await addonServer(id);
  if (server?.type === "workshop") {
    // One of the popular mods, with the mods it needs.
    const mod = POPULAR_TMOD_MODS.find((m) => m.id === projectId);
    return mod ? addWorkshopMods(server, [mod.id, ...mod.with]) : { error: "failed" };
  }
  // A CurseForge search result: "cf:<project ID>".
  const cf = projectId.match(/^cf:(\d{1,10})$/);
  if (server && cf) return addCurseforgeMod(server, Number(cf[1]));
  // A Hangar or SpigotMC search result.
  if (server && sitePlugin(projectId)) return addSitePlugin(server, projectId);
  if (!server || !isProjectId(projectId)) return { error: "failed" };
  if (server.plugins.includes(projectId)) return {};
  if (server.plugins.length >= PLUGINS_MAX) return { error: "tooMany" };
  const plugin = await getAddon(projectId, server.type, server.kind);
  if (typeof plugin === "string") return { error: plugin };
  // The game mode's own plugins are always there.
  if ((GAME_MODE_PLUGINS[server.kind] ?? []).some((p) => p.slug === plugin.slug)) return {};
  // The image would skip it on this version, and the owner would wonder why it doesn't work.
  const { missing, version } = await withoutBuild(server, [plugin.id]);
  if (missing.length) return { error: "noVersion", name: plugin.title, version };
  return savePlugins(server, [...server.plugins, plugin.id]);
}

/** Adds a mod from a pasted CurseForge link, slug or project ID. */
export async function addCurseforgeLinkAction(id: string, input: string): Promise<PluginResult> {
  const server = await addonServer(id);
  if (server?.type !== "mod") return { error: "failed" };
  let modId;
  try {
    modId = await curseforgeModId(input.slice(0, 300));
  } catch (err) {
    console.error("curseforge lookup failed", input, err);
    return { error: "curseforgeUnavailable" };
  }
  return modId ? addCurseforgeMod(server, modId) : { error: "cfLink" };
}

/** Adds a plugin from a pasted Hangar or SpigotMC link. */
export async function addSiteLinkAction(id: string, input: string): Promise<PluginResult> {
  const server = await addonServer(id);
  if (server?.type !== "plugin") return { error: "failed" };
  const entry = sitePluginFromLink(input.slice(0, 300));
  return entry ? addSitePlugin(server, entry) : { error: "siteLink" };
}

/**
 * Downloads a Hangar or SpigotMC plugin's jar into the server's plugins
 * folder (the image only installs Modrinth's), for the server's Minecraft
 * version when it has one, and lists it so the owner can remove it.
 */
async function addSitePlugin(server: Server & { type: string }, entry: string): Promise<PluginResult> {
  const file = sitePluginFile(entry);
  if (server.type !== "plugin" || !file) return { error: "failed" };
  if (server.plugins.includes(entry)) return {};
  if (server.plugins.length >= PLUGINS_MAX) return { error: "tooMany" };
  // The files are on a game machine only while the server is paid for and set up.
  if (!["RUNNING", "STOPPED", "SLEEPING"].includes(server.status) || !canChangeFiles(server)) return { error: "siteNotOnHost" };
  // The version the server runs ("Najnowsza" too); island game modes pick theirs, so the newest build goes there.
  const versions = await versionsToCheck(server.kind, server.version);
  const mc = versions ? downloadVersion(versions) : undefined;
  const got = await downloadSitePlugin(entry, mc);
  if ("error" in got) return { error: got.error, name: got.name };
  // SpigotMC only has the newest build, which may be made for a newer Minecraft: Paper wouldn't load it.
  const api = pluginApiVersion(got.jar);
  if (mc && api && apiTooNew(api, mc)) return { error: "pluginTooNew", name: got.title, version: api };
  try {
    await agent.writeFile(server.id, file, got.jar, got.jar.byteLength);
  } catch (err) {
    console.error("site plugin upload failed", server.id, entry, err);
    return { error: err instanceof agent.AgentError && err.status === 507 ? "siteNoSpace" : "failed" };
  }
  return savePlugins(server, [...server.plugins, entry]);
}

/**
 * Adds a CurseForge mod, pinned to its file for the server's version and
 * loader, with the mods it needs (Fabric API from Modrinth, like Modrinth's mods get it).
 */
async function addCurseforgeMod(server: Server & { type: string }, modId: number): Promise<PluginResult> {
  if (server.type !== "mod") return { error: "failed" };
  // A file is picked for one Minecraft version; "newest" would change under it.
  if (server.version === "LATEST") return { error: "cfNeedsVersion" };
  const have = new Set(server.plugins.map((p) => curseforgeMod(p)?.modId).filter((m) => m !== undefined));
  if (have.has(modId)) return {};
  const pinned = await pinCurseforgeMods([modId], server.version, server.kind, have);
  if ("error" in pinned) return { error: pinned.error, name: pinned.name };
  const added = [
    ...pinned.curseforge.map((f) => curseforgeEntry(f.modId, f.fileId)),
    ...pinned.modrinth.filter((m) => !server.plugins.includes(m)),
  ];
  if (added.length === 0) return {};
  if (server.plugins.length + added.length > PLUGINS_MAX) return { error: "tooMany" };
  return savePlugins(server, [...server.plugins, ...added]);
}

/**
 * Adds a tModLoader mod from a pasted Steam Workshop link or ID, with the mods
 * it needs; a collection's link adds all its mods.
 */
export async function addWorkshopModAction(id: string, input: string): Promise<PluginResult> {
  const server = await addonServer(id);
  if (server?.type !== "workshop") return { error: "failed" };
  const workshopId = parseWorkshopInput(input.slice(0, 300));
  if (!workshopId) return { error: "workshopLink" };
  let mods;
  try {
    mods = await resolveWorkshopItem(workshopId);
  } catch (err) {
    console.error("Steam Workshop lookup failed", workshopId, err);
    return { error: "steamUnavailable" };
  }
  if (!mods || mods.length === 0) return { error: "pluginNotFound" };
  return addWorkshopMods(server, mods.map((m) => m.id));
}

async function addWorkshopMods(server: Server, ids: string[]): Promise<PluginResult> {
  const missing = [...new Set(ids)].filter((m) => !server.plugins.includes(m));
  if (missing.length === 0) return {};
  if (server.plugins.length + missing.length > PLUGINS_MAX) return { error: "tooMany" };
  return savePlugins(server, [...server.plugins, ...missing]);
}

/** Adds the plugins of a ready set that the server doesn't have yet. */
export async function addPluginSetAction(id: string, setId: string): Promise<PluginResult> {
  const server = await addonServer(id);
  const set = PLUGIN_SETS.find((s) => s.id === setId);
  if (!server || server.type !== "plugin" || !set || !setFits(set, server.kind)) return { error: "failed" };
  const absent = pluginIds(set.plugins).filter((p) => !server.plugins.includes(p));
  if (absent.length === 0) return {};
  // Only the ones made for the server's version.
  const { missing: noBuild, version } = await withoutBuild(server, absent);
  const missing = absent.filter((p) => !noBuild.includes(p));
  if (missing.length === 0) return { error: "setNoVersion", version };
  if (server.plugins.length + missing.length > PLUGINS_MAX) return { error: "tooMany" };
  return savePlugins(server, [...server.plugins, ...missing]);
}

export async function removePluginAction(id: string, projectId: string): Promise<PluginResult> {
  const server = await addonServer(id);
  if (!server) return { error: "failed" };
  // A Hangar or SpigotMC plugin is a file the panel put there; it goes with it.
  const file = sitePluginFile(projectId);
  if (file && server.plugins.includes(projectId) && ["RUNNING", "STOPPED", "SLEEPING"].includes(server.status)) {
    try {
      await agent.changeFiles(server.id, { remove: file });
    } catch (err) {
      // Already deleted in Files is fine.
      if (!(err instanceof agent.AgentError && err.status === 404)) {
        console.error("site plugin removal failed", server.id, projectId, err);
        return { error: "failed" };
      }
    }
  }
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
