import "server-only";
import type { Server } from "@prisma/client";
import * as agent from "./agent";
import { repinCurseforgeMods } from "./curseforge";
import { canChangeFiles } from "./files";
import { isModLoader } from "./modpacks";
import { PAPER_INSTALL_LOADERS, getPluginInfos, newestGameRelease, projectsWithoutBuild } from "./modrinth";
import { addonType, isProjectId, sitePlugin, sitePluginFile } from "./plugins";
import { versionsFor } from "./settings";
import { apiTooNew, downloadSitePlugin, getSitePluginInfos, pluginApiVersion } from "./sitePlugins";

// Plugins and mods follow the server's Minecraft version. The image installs
// Modrinth's for the version it starts on (and skips one with no build for it);
// jars the panel put in the plugins folder itself (Hangar, SpigotMC) stay as
// they were downloaded, so a version change downloads them again. A version
// change takes off the list what has nothing for the new version, so the owner
// sees it's gone instead of wondering why it doesn't work. Only the jar goes:
// its settings folder stays, and comes back into use if it's added again.

const RELEASE = /^\d+\.\d+(\.\d+)?$/;

function compareVersions(a: string, b: string) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/** The newest Minecraft version Paper has builds for (kept for an hour); undefined if it doesn't answer. */
async function newestPaperVersion(): Promise<string | undefined> {
  try {
    const res = await fetch(`${process.env.PAPER_API_URL ?? "https://fill.papermc.io"}/v3/projects/paper`, {
      headers: { Accept: "application/json", "User-Agent": "Filipsq/mc-host (mchosting.pl)" },
      signal: AbortSignal.timeout(10_000),
      next: { revalidate: 3600 },
    });
    if (!res.ok) throw new Error(`Paper answered ${res.status}`);
    // Versions grouped by family: { versions: { "26.1": ["26.1.2", "26.1"], "1.21": [...] } }.
    const { versions } = (await res.json()) as { versions?: unknown };
    const all = (Array.isArray(versions) ? versions : Object.values(versions ?? {}).flat()).filter(
      (v): v is string => typeof v === "string" && RELEASE.test(v),
    );
    return all.sort(compareVersions).at(-1);
  } catch (err) {
    console.error("paper version list failed", err);
    return undefined;
  }
}

/**
 * The Minecraft versions a server on `version` may be running, for checking
 * its plugins and mods: the version itself, or for "Najnowsza" (LATEST) the
 * newest Paper and the newest release (Paper can be a step behind for a few
 * days). Null when the server's kind picks its version itself (the island game
 * modes and mod packs), or nobody answers.
 */
export async function versionsToCheck(kind: string, version: string): Promise<string[] | null> {
  if (versionsFor(kind).length === 0) return null;
  if (version !== "LATEST") return [version];
  const [paper, release] = await Promise.all([isModLoader(kind) ? undefined : newestPaperVersion(), newestGameRelease()]);
  const found = [...new Set([paper, release].filter((v) => v !== undefined))];
  return found.length ? found : null;
}

/** The one version to download a jar for: what the server runs (for LATEST, the newest Paper, which it starts on). */
export const downloadVersion = (versions: string[]) => versions[0];

type Fitted = { plugins: string[]; dropped: string[] };

/**
 * The server's plugins or mods once it moves to Minecraft `to`: Modrinth ones
 * with no build for it leave the list, CurseForge mods are pinned again, and
 * Hangar and SpigotMC jars are downloaded again for it (or taken out when
 * there's none that loads on it). `dropped` names what left. Null if
 * CurseForge can't be reached, so nothing is lost then. Changes the server's
 * files, so call it right before saving the new version.
 */
export async function fitAddonsToVersion(server: Server, to: string, kind = server.kind): Promise<Fitted | null> {
  const type = addonType({ edition: server.edition, kind });
  if (type !== "plugin" && type !== "mod") return { plugins: server.plugins, dropped: [] };
  let plugins = server.plugins;
  const dropped: string[] = [];
  if (type === "mod") {
    const repinned = await repinCurseforgeMods(plugins, to, kind);
    if (!repinned) return null;
    ({ plugins } = repinned);
    dropped.push(...repinned.dropped);
  }
  const versions = await versionsToCheck(kind, to);
  if (!versions) return { plugins, dropped };

  const loaders = type === "plugin" ? PAPER_INSTALL_LOADERS : [kind];
  const without = await projectsWithoutBuild(plugins.filter(isProjectId), loaders, versions);
  if (without.length) {
    const infos = await getPluginInfos(without);
    dropped.push(...without.map((id) => infos.get(id)?.title ?? id));
    plugins = plugins.filter((p) => !without.includes(p));
  }

  const sites = plugins.filter((p) => sitePlugin(p));
  if (type === "plugin" && sites.length && canChangeFiles(server) && ["RUNNING", "STOPPED", "SLEEPING"].includes(server.status)) {
    const mc = downloadVersion(versions);
    const infos = await getSitePluginInfos(sites);
    const gone: string[] = [];
    for (const entry of sites) {
      const kept = await refitSitePlugin(server.id, entry, mc);
      if (!kept) {
        gone.push(entry);
        dropped.push(infos.get(entry)?.title ?? entry);
      }
    }
    plugins = plugins.filter((p) => !gone.includes(p));
  }
  if (dropped.length) console.log("plugins without a build for the new version", server.id, to, dropped);
  return { plugins, dropped };
}

/**
 * Puts the Hangar or SpigotMC plugin's jar for Minecraft `mc` in the plugins
 * folder. False when it has none that loads there (its jar is then deleted);
 * true when it's kept, also when the site doesn't answer (the jar stays as it was).
 */
async function refitSitePlugin(id: string, entry: string, mc: string): Promise<boolean> {
  const file = sitePluginFile(entry)!;
  // Hangar picks the build for that version; SpigotMC only has its newest one.
  const got = await downloadSitePlugin(entry, mc);
  if ("error" in got) {
    if (got.error !== "siteNoVersion") return true;
    await removeJar(id, file);
    return false;
  }
  const api = pluginApiVersion(got.jar);
  if (!api || !apiTooNew(api, mc)) {
    try {
      await agent.writeFile(id, file, got.jar, got.jar.byteLength);
    } catch (err) {
      console.error("site plugin update failed", id, entry, err);
    }
    return true;
  }
  // The newest SpigotMC build is made for a newer Minecraft: the jar there may still be one that loads.
  const current = await readJar(id, file);
  if (current) {
    const old = pluginApiVersion(current);
    if (!old || !apiTooNew(old, mc)) return true;
  }
  await removeJar(id, file);
  return false;
}

const JAR_MAX = 50 << 20;

async function readJar(id: string, file: string): Promise<Uint8Array | null> {
  try {
    const res = await agent.openFile(id, file, { max: JAR_MAX });
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function removeJar(id: string, file: string) {
  await agent.changeFiles(id, { remove: file }).catch((err) => {
    if (!(err instanceof agent.AgentError && err.status === 404)) console.error("site plugin removal failed", id, file, err);
  });
}
