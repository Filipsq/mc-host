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
import { CURATED_PACKS, MOD_LOADERS, parseModrinthLink, planAtLeast } from "@/lib/modpacks";
import { LOADER_VERSIONS, MOD_DEFAULT_VERSION, versionsFor } from "@/lib/settings";
import { canRunNonPremium, supportsPlugins } from "@/lib/plugins";
import { resolveModpack, type ResolvedPack } from "@/lib/modrinth";
import { SERVER_TYPES, minPlanFor, usesMods } from "@/lib/serverType";
import { activeLevel, nextWorldName, randomSeed } from "@/lib/worlds";
import type { Messages } from "@/i18n/messages";
import type { ServerErrorCode } from "../../actions";

export type TypeError = keyof Messages["serverType"]["errors"] | ServerErrorCode;
export type TypeState = { error?: TypeError; values?: Record<string, string> };

const typeSchema = z.object({
  type: z.enum(SERVER_TYPES),
  loader: z.enum(MOD_LOADERS).default("fabric"),
  modVersion: z.string().max(20).optional(),
  pack: z.string().optional(), // a curated pack's slug, or "custom" for packLink
  packLink: z.string().max(300).optional(),
});

/** "mods-fabric", or "mods-fabric-2" if that's taken. */
function freeName(taken: string[], base: string) {
  const names = new Set(taken);
  for (let i = 1; ; i++) {
    const name = i === 1 ? base : `${base}-${i}`;
    if (!names.has(name)) return name;
  }
}

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
  let pack: ResolvedPack | null = null;
  if (type === "modpack") {
    const curated = CURATED_PACKS.find((p) => p.slug === parsed.data.pack);
    const ref = curated ? { slug: curated.slug } : parseModrinthLink(parsed.data.packLink ?? "");
    if (!ref) return { error: "modpackLink", values };
    if (!planAtLeast(server.plan, minPlanFor("modpack", curated?.slug))) return { error: "needsPlan", values };
    const resolved = await resolveModpack(ref);
    if (typeof resolved === "string") return { error: resolved, values };
    pack = resolved;
    version = pack.gameVersion;
  } else if (type === "mods") {
    version = LOADER_VERSIONS[loader].find((v) => v === parsed.data.modVersion) ?? MOD_DEFAULT_VERSION;
  } else if (type === "vanilla") {
    version = versionsFor("vanilla").includes(server.version) ? server.version : "LATEST";
  }
  const same =
    kind === server.kind &&
    (type === "modpack"
      ? pack?.slug === server.modpack && pack?.versionId === server.modpackVersionId
      : type !== "mods" || version === server.version);
  if (same) return { error: "same", values };

  try {
    if (planById(server.plan).backupsKept > 0) {
      await agent.createBackup(server.id).catch((err) => console.error("pre-type-change backup failed", server.id, err));
    }
    const { entries } = await agent.listFiles(server.id, ".");
    const names = entries.map((e) => e.name);
    // Mods of the old type would load into the new one (or clash with a pack's), so they move aside.
    if (usesMods(server.kind) && names.includes("mods")) {
      const to = freeName(names, `mods-${server.kind === "modpack" ? (server.modpack ?? "pack") : server.kind}`);
      await agent.changeFiles(server.id, { rename: "mods", to });
    }
    const keepPlugins = supportsPlugins(server) && supportsPlugins({ edition: "JAVA", kind });
    const updated = await db.server.update({
      where: { id: server.id },
      data: {
        kind,
        version,
        modpack: pack?.slug ?? null,
        modpackTitle: pack?.title ?? null,
        modpackVersionId: pack?.versionId ?? null,
        modpackVersion: pack?.versionNumber ?? null,
        modpackLoader: pack?.loader ?? null,
        plugins: keepPlugins ? server.plugins : [],
        onlineMode: canRunNonPremium({ edition: "JAVA", kind }) ? server.onlineMode : true,
        // A fresh world; the old one stays in the server's files, under Worlds.
        level: nextWorldName([...names, activeLevel(server)]),
        levelSeed: randomSeed(),
        levelType: "normal",
      },
    });
    await applyToHost(updated);
  } catch (err) {
    console.error("change type failed", server.id, err);
    return { error: "failed", values };
  }
  revalidatePath(`/dashboard/servers/${id}`);
  redirect(`/dashboard/servers/${id}?type=changed`);
}
