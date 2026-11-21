"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import * as agent from "@/lib/agent";
import { getServerFor } from "@/lib/access";
import { applyToHost, onHost } from "@/lib/servers";
import { planById } from "@/lib/plans";
import { MOD_LOADERS, PACK_HAND_MODS_DIR, PACK_UPLOAD_DIR, parseCurseforgeLink, planAtLeast, planForRam } from "@/lib/modpacks";
import { curseforgeEnabled, readUploadedManifest, resolveUploadedPack, type UploadedPackError } from "@/lib/curseforge";
import { fitAddonsToVersion, offeredVersions } from "@/lib/addonVersions";
import { LOADER_VERSIONS, MOD_DEFAULT_VERSION } from "@/lib/settings";
import { PLUGINS_MAX, canRunNonPremium, isProjectId, supportsPlugins } from "@/lib/plugins";
import { type PackChoice, packFields, packNamed, resolvePackChoice } from "@/lib/packChoice";
import { SERVER_TYPES, minPlanFor, usesMods } from "@/lib/serverType";
import { activeLevel, nextWorldName, randomSeed } from "@/lib/worlds";
import { freeName, undoSnapshot } from "@/lib/undoChange";
import type { Messages } from "@/i18n/messages";
import type { ServerErrorCode } from "../../actions";

export type TypeError = keyof Messages["serverType"]["errors"] | ServerErrorCode;
export type UploadPackError = UploadedPackError | "modpackLink" | "packNeedsHandMods" | "modpackNeedsPro" | "modpackNeedsMax" | "modpackNeedsStandard" | "needsPlan" | "notOnHost" | "failed";
export type UploadPackState = { error?: UploadPackError; handMods?: { name: string; fileName: string }[] };

// Where the browser puts the zip before it's checked (src/app/dashboard/servers/[id]/type/UploadPack.tsx).
const uploadPattern = new RegExp(`^${PACK_UPLOAD_DIR}/upload-[a-z0-9]{8,32}\\.zip$`);

/**
 * Switches the server to a CurseForge pack from a zip the owner downloaded on
 * CurseForge and uploaded, for packs whose authors allow downloads only there
 * (the image still downloads every mod it may from CurseForge itself). The
 * link says which pack it is; the zip's size must match one of its files.
 */
export async function uploadPackAction(id: string, path: string, link: string): Promise<UploadPackState> {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const server = await getServerFor(id, session.user.id, "owner");
  if (!server || server.edition !== "JAVA") redirect("/dashboard");
  if (!onHost(server)) return { error: "notOnHost" };
  if (!uploadPattern.test(path) || !curseforgeEnabled()) return { error: "failed" };
  const ref = parseCurseforgeLink(link);
  if (!ref) return { error: "modpackLink" };
  if (!planAtLeast(server.plan, "STARTER")) return { error: "needsPlan" };

  const drop = () => agent.changeFiles(server.id, { remove: path }).catch(() => {});
  try {
    const { entries } = await agent.listFiles(server.id, PACK_UPLOAD_DIR);
    const size = entries.find((e) => `${PACK_UPLOAD_DIR}/${e.name}` === path)?.size;
    if (!size) return { error: "failed" };
    const manifest = await readUploadedManifest(await agent.openFile(server.id, path));
    if (!manifest) return (await drop(), { error: "packZipNoManifest" });
    const pack = await resolveUploadedPack(ref, size, manifest);
    if (typeof pack === "string") {
      if (pack !== "curseforgeUnavailable") await drop();
      return { error: pack };
    }
    const need = planForRam(pack.ramGb);
    if (!planAtLeast(server.plan, need)) {
      return { error: need === "MAX" ? "modpackNeedsMax" : need === "PRO" ? "modpackNeedsPro" : need === "STANDARD" ? "modpackNeedsStandard" : "needsPlan" };
    }
    // Mods whose authors forbid downloads outside CurseForge: the owner uploads those jars to the "mody" folder.
    if (pack.handMods.length) {
      await agent.changeFiles(server.id, { mkdir: PACK_HAND_MODS_DIR }).catch(() => {});
      const have = new Set((await agent.listFiles(server.id, PACK_HAND_MODS_DIR)).entries.map((e) => e.name));
      const missing = pack.handMods.filter((m) => !have.has(m.fileName));
      if (missing.length) return { error: "packNeedsHandMods", handMods: missing.slice(0, 100) };
    }
    // Kept under the pack's file ID: the agent hands it to the image on every start.
    const kept = `${PACK_UPLOAD_DIR}/${pack.fileId}.zip`;
    if (kept !== path) {
      if (entries.some((e) => `${PACK_UPLOAD_DIR}/${e.name}` === kept)) await agent.changeFiles(server.id, { remove: kept });
      await agent.changeFiles(server.id, { rename: path, to: kept });
    }
    await agent.changeFiles(server.id, { mkdir: PACK_HAND_MODS_DIR }).catch(() => {});
    const choice: PackChoice = {
      source: "curseforge-zip",
      slug: pack.slug,
      title: pack.title,
      versionId: String(pack.fileId),
      versionNumber: pack.fileName,
      gameVersion: pack.gameVersion,
      loader: pack.loader,
      ramGb: pack.ramGb,
    };
    const dropped = await switchType(server, "modpack", pack.gameVersion, choice, []);
    if (!dropped) return { error: "failed" };
  } catch (err) {
    console.error("uploaded pack failed", server.id, err);
    return { error: "failed" };
  }
  revalidatePath(`/dashboard/servers/${id}`);
  redirect(`/dashboard/servers/${id}?type=changed`);
}

export type TypeState = { error?: TypeError; values?: Record<string, string> };

const typeSchema = z.object({
  type: z.enum(SERVER_TYPES),
  loader: z.enum(MOD_LOADERS).default("fabric"),
  modVersion: z.string().max(20).optional(),
  pack: z.string().optional(), // a curated pack's slug, or "custom" for packLink
  packLink: z.string().max(300).optional(), // a Modrinth or CurseForge link, or a pack from the Modrinth search
  mods: z.string().max(600).optional(), // Modrinth mods picked on a plain server's Mods page, comma-separated
});

/**
 * Switches a Java server to another type: Paper, a game mode, mods on a loader,
 * or a mod pack. The server starts on a new world and the old one stays in its
 * Worlds; paid plans get a backup first, and the old type's mods move aside.
 */
export async function changeTypeAction(id: string, _: TypeState, form: FormData): Promise<TypeState> {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const server = await getServerFor(id, session.user.id, "owner");
  if (!server || server.edition !== "JAVA") redirect("/dashboard");
  const values = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const parsed = typeSchema.safeParse(values);
  if (!parsed.success) return { error: "failed", values };
  if (!onHost(server)) return { error: "notOnHost", values };
  const { type, loader } = parsed.data;
  const kind = type === "mods" ? loader : type;

  let version = "LATEST"; // game modes follow their plugins
  let pack: PackChoice | null = null;
  if (type === "modpack") {
    if (!packNamed(parsed.data)) return { error: "modpackLink", values };
    if (!planAtLeast(server.plan, minPlanFor("modpack", parsed.data.pack))) return { error: "needsPlan", values };
    const resolved = await resolvePackChoice(parsed.data);
    if (typeof resolved === "string") return { error: resolved, values };
    // A CurseForge pack's size is only known now.
    const need = resolved.ramGb ? planForRam(resolved.ramGb) : "STARTER";
    if (!planAtLeast(server.plan, need)) {
      return { error: need === "MAX" ? "modpackNeedsMax" : need === "PRO" ? "modpackNeedsPro" : need === "STANDARD" ? "modpackNeedsStandard" : "needsPlan", values };
    }
    pack = resolved;
    version = pack.gameVersion;
  } else if (type === "mods") {
    version = LOADER_VERSIONS[loader].find((v) => v === parsed.data.modVersion) ?? MOD_DEFAULT_VERSION;
  } else if (type === "vanilla") {
    version = (await offeredVersions("vanilla")).includes(server.version) ? server.version : "LATEST";
  }
  const same =
    kind === server.kind &&
    (type === "modpack"
      ? pack?.slug === server.modpack && pack?.versionId === server.modpackVersionId && packFields(pack).modpackSource === server.modpackSource
      : type !== "mods" || version === server.version);
  if (same) return { error: "same", values };

  // Mods picked before the switch; their versions are checked when the server starts, like any added mod.
  const picked = type === "mods" ? [...new Set((parsed.data.mods ?? "").split(","))].filter(isProjectId).slice(0, PLUGINS_MAX) : [];
  const dropped = await switchType(server, kind, version, pack, picked);
  if (!dropped) return { error: "failed", values };
  revalidatePath(`/dashboard/servers/${id}`);
  redirect(`/dashboard/servers/${id}?type=changed${dropped.length ? `&dropped=${encodeURIComponent(dropped.join(", ").slice(0, 300))}` : ""}`);
}

type OwnedServer = NonNullable<Awaited<ReturnType<typeof getServerFor>>>;

/**
 * Puts the server on its new type: a backup first on paid plans, the old mods
 * moved aside, a fresh world. Returns the plugins dropped for the new version,
 * or null if it failed.
 */
async function switchType(server: OwnedServer, kind: string, version: string, pack: PackChoice | null, picked: string[]): Promise<string[] | null> {
  try {
    if (planById(server.plan).backupsKept > 0) {
      await agent.createBackup(server.id).catch((err) => console.error("pre-type-change backup failed", server.id, err));
    }
    const { entries } = await agent.listFiles(server.id, ".");
    const names = entries.map((e) => e.name);
    // Mods of the old type would load into the new one (or clash with a pack's), so they move aside.
    let modsFolder: string | null = null;
    if (usesMods(server.kind) && names.includes("mods")) {
      modsFolder = freeName(names, `mods-${server.kind === "modpack" ? (server.modpack ?? "pack") : server.kind}`);
      await agent.changeFiles(server.id, { rename: "mods", to: modsFolder });
    }
    const keepPlugins = supportsPlugins(server) && supportsPlugins({ edition: "JAVA", kind });
    // Plugins kept on another version: the ones with nothing for it leave the list (src/lib/addonVersions.ts).
    const fitted = keepPlugins && version !== server.version ? await fitAddonsToVersion(server, version, kind) : null;
    const updated = await db.server.update({
      where: { id: server.id },
      data: {
        kind,
        version,
        ...packFields(pack),
        plugins: keepPlugins ? (fitted?.plugins ?? server.plugins) : picked,
        onlineMode: canRunNonPremium({ edition: "JAVA", kind, version, modpackLoader: pack?.loader }) ? server.onlineMode : true,
        // A fresh world; the old one stays in the server's files, under Worlds.
        level: nextWorldName([...names, activeLevel(server)]),
        levelSeed: randomSeed(),
        levelType: "normal",
        // "Cofnij zmianę" puts all this back (src/lib/undoChange.ts).
        undoChange: undoSnapshot(server, "type", activeLevel(server), modsFolder),
      },
    });
    await applyToHost(updated);
    return fitted?.dropped ?? [];
  } catch (err) {
    console.error("change type failed", server.id, err);
    return null;
  }
}
