"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import * as agent from "@/lib/agent";
import { getServerFor } from "@/lib/access";
import { applyToHost, onHost } from "@/lib/servers";
import { planById } from "@/lib/plans";
import { versionsFor } from "@/lib/settings";
import { activeLevel, nextWorldName, randomSeed } from "@/lib/worlds";
import { MINIGAMES_FROM, minigamesBack, type MinigamesBack } from "@/lib/minigamesSwitch";

async function ownServer(id: string) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const server = await getServerFor(id, session.user.id, "owner");
  if (!server || server.edition !== "JAVA") redirect(`/dashboard/servers/${id}`);
  return server;
}

const page = (id: string, done: string) => `/dashboard/servers/${id}/minigames?done=${done}`;

/** Turns Minigames on: the world played until now stays in Worlds, and what the server ran is remembered. */
export async function enableMinigamesAction(id: string) {
  const server = await ownServer(id);
  if (!MINIGAMES_FROM.includes(server.kind)) redirect(`/dashboard/servers/${id}`);
  if (!onHost(server)) redirect(page(id, "notOnHost"));
  try {
    if (planById(server.plan).backupsKept > 0) {
      await agent.createBackup(server.id).catch((err) => console.error("pre-minigames backup failed", server.id, err));
    }
    let level = server.minigamesLevel;
    let seed: string | undefined;
    if (!level) {
      const { entries } = await agent.listFiles(server.id, ".");
      level = nextWorldName([...entries.map((e) => e.name), activeLevel(server)]);
      seed = randomSeed();
    }
    const back: MinigamesBack = {
      kind: server.kind,
      version: server.version,
      level: activeLevel(server),
      levelSeed: server.levelSeed,
      levelType: server.levelType,
      plugins: server.plugins,
      onlineMode: server.onlineMode,
    };
    const updated = await db.server.update({
      where: { id: server.id },
      data: {
        kind: "minigames",
        version: versionsFor("minigames").includes(server.version) ? server.version : "LATEST",
        // The owner's plugins (homes, spawns) would get in the games' way; they come back with the world.
        plugins: [],
        pluginsPending: false,
        level,
        ...(seed && { levelSeed: seed, levelType: "normal" }),
        minigamesBack: back,
        minigamesLevel: level,
      },
    });
    await applyToHost(updated);
  } catch (err) {
    console.error("enable minigames failed", server.id, err);
    redirect(page(id, "failed"));
  }
  revalidatePath(`/dashboard/servers/${id}`, "layout");
  redirect(page(id, "on"));
}

/** Goes back to what the server ran before Minigames, on its old world. The minigames world stays for next time. */
export async function leaveMinigamesAction(id: string) {
  const server = await ownServer(id);
  const back = minigamesBack(server);
  if (server.kind !== "minigames" || !back) redirect(`/dashboard/servers/${id}`);
  if (!onHost(server)) redirect(page(id, "notOnHost"));
  try {
    const updated = await db.server.update({
      where: { id: server.id },
      data: {
        kind: back.kind,
        version: back.version,
        plugins: back.plugins,
        pluginsPending: false,
        onlineMode: back.onlineMode,
        level: back.level,
        levelSeed: back.levelSeed,
        levelType: back.levelType,
        minigamesBack: Prisma.DbNull,
      },
    });
    await applyToHost(updated);
  } catch (err) {
    console.error("leave minigames failed", server.id, err);
    redirect(page(id, "failed"));
  }
  revalidatePath(`/dashboard/servers/${id}`, "layout");
  redirect(page(id, "off"));
}
