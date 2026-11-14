"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import * as agent from "@/lib/agent";
import { getServerFor } from "@/lib/access";
import { applyToHost, onHost, worldTooNew } from "@/lib/servers";
import { planById } from "@/lib/plans";
import { planAtLeast } from "@/lib/modpacks";
import { fitAddonsToVersion } from "@/lib/addonVersions";
import { minPlanFor, typeOfKind } from "@/lib/serverType";
import { freeName, undoChange } from "@/lib/undoChange";

export type UndoResult = "done" | "gone" | "notOnHost" | "needsPlan" | "worldTooNew" | "failed";

/**
 * "Cofnij zmianę": puts the server back to what it ran before its last type or
 * version change (src/lib/undoChange.ts): type, version, pack, plugins and mods
 * list, non-premium and the world. The world played since stays in Worlds, and
 * the mods the change moved aside come back into the mods folder.
 */
export async function undoChangeAction(id: string) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const server = await getServerFor(id, session.user.id, "owner");
  if (!server || server.edition !== "JAVA") redirect(`/dashboard/servers/${id}`);
  const done = (result: UndoResult) => `/dashboard/servers/${id}?undo=${result}`;
  const back = undoChange(server);
  if (!back) redirect(done("gone"));
  if (!onHost(server)) redirect(done("notOnHost"));
  // The plan may have gone down since, below what the old mod pack needs.
  if (!planAtLeast(server.plan, minPlanFor(typeOfKind(back.kind), back.modpack ?? undefined))) redirect(done("needsPlan"));
  // A world a 26.x version has opened can't go back to 1.x.
  if (await worldTooNew(server, back.level, back.version)) redirect(done("worldTooNew"));

  try {
    if (planById(server.plan).backupsKept > 0) {
      await agent.createBackup(server.id).catch((err) => console.error("pre-undo backup failed", server.id, err));
    }
    if (back.modsFolder) {
      const { entries } = await agent.listFiles(server.id, ".");
      const names = entries.map((e) => e.name);
      if (names.includes(back.modsFolder)) {
        // The mods of the type being left move aside the same way, so changing again finds them.
        if (names.includes("mods")) {
          const aside = freeName(names, `mods-${server.kind === "modpack" ? (server.modpack ?? "pack") : server.kind}`);
          await agent.changeFiles(server.id, { rename: "mods", to: aside });
        }
        await agent.changeFiles(server.id, { rename: back.modsFolder, to: "mods" });
      }
    }
    // Hangar and SpigotMC jars are downloaded again for the old version; Modrinth ones
    // the image installs itself on the next start. If a site doesn't answer, the old list stays.
    let plugins = back.plugins;
    if (back.version !== server.version || back.kind !== server.kind) {
      const fitted = await fitAddonsToVersion({ ...server, kind: back.kind, plugins: back.plugins }, back.version, back.kind).catch((err) => {
        console.error("undo plugin fit failed", server.id, err);
        return null;
      });
      if (fitted) plugins = fitted.plugins;
    }
    const updated = await db.server.update({
      where: { id: server.id },
      data: {
        kind: back.kind,
        version: back.version,
        modpack: back.modpack,
        modpackSource: back.modpackSource,
        modpackTitle: back.modpackTitle,
        modpackVersionId: back.modpackVersionId,
        modpackVersion: back.modpackVersion,
        modpackLoader: back.modpackLoader,
        plugins,
        pluginsPending: false,
        onlineMode: back.onlineMode,
        ownLogin: back.ownLogin,
        level: back.level,
        levelSeed: back.levelSeed,
        levelType: back.levelType,
        undoChange: Prisma.DbNull,
      },
    });
    await applyToHost(updated);
  } catch (err) {
    console.error("undo change failed", server.id, err);
    redirect(done("failed"));
  }
  revalidatePath(`/dashboard/servers/${id}`, "layout");
  redirect(done("done"));
}
