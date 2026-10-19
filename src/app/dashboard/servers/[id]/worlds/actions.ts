"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Server } from "@prisma/client";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import * as agent from "@/lib/agent";
import { getServerFor } from "@/lib/access";
import { applyToHost, onHost, worldTooNew } from "@/lib/servers";
import { canChangeFiles, fileError, type FileError } from "@/lib/files";
import {
  activeLevel,
  isKnownWorldName,
  isValidSeed,
  isValidWorldName,
  javaWorldFolders,
  randomSeed,
  WORLD_UPLOAD_DIR,
  worldTypes,
  type WorldType,
} from "@/lib/worlds";
import { isPreYearVersion } from "@/lib/settings";
import type { Messages } from "@/i18n/messages";

export type WorldError = keyof Messages["worlds"]["errors"] | FileError;
export type WorldState = { error?: WorldError; values?: Record<string, string> };

/** The server, if the user may change its files and it's on the game host. */
async function worldServer(id: string): Promise<Server | WorldError> {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const server = await getServerFor(id, session.user.id, "files");
  if (!server || server.edition === "TERRARIA") redirect("/dashboard");
  if (!onHost(server)) return canChangeFiles(server) ? "notOnHost" : "readOnly";
  return server;
}

function worldError(err: unknown): WorldError {
  if (err instanceof agent.AgentError && (err.message === "active" || err.message === "noWorld")) return err.message;
  return fileError(err);
}

/** Runs the server on another world (or one it makes on its next start), restarting it if it's on. */
async function playWorld(server: Server, level: string, newWorld?: { seed: string; type: WorldType }) {
  const updated = await db.server.update({
    where: { id: server.id },
    data: { level, levelSeed: newWorld?.seed ?? null, levelType: newWorld?.type ?? null },
  });
  await applyToHost(updated);
}

/** Whether a new world's folders would clash with anything in the server's files. */
async function nameTaken(server: Server, name: string) {
  const { entries } = await agent.listFiles(server.id, server.edition === "JAVA" ? "." : "worlds").catch(() => ({ entries: [] }));
  const taken = new Set(entries.map((e) => e.name.toLowerCase()));
  const folders = server.edition === "JAVA" ? javaWorldFolders(name) : [name];
  return name.toLowerCase() === activeLevel(server).toLowerCase() || folders.some((f) => taken.has(f.toLowerCase()));
}

export async function switchWorldAction(id: string, name: string): Promise<WorldState> {
  const server = await worldServer(id);
  if (typeof server === "string") return { error: server };
  try {
    const { worlds } = await agent.listWorlds(server.id, server.edition);
    const world = worlds.find((w) => w.name === name);
    if (!world) return { error: "notFound" };
    if (world.newGame && server.edition === "JAVA" && isPreYearVersion(server.version)) return { error: "worldTooNew" };
    await playWorld(server, name);
  } catch (err) {
    return { error: worldError(err) };
  }
  revalidatePath(`/dashboard/servers/${id}`);
  redirect(`/dashboard/servers/${id}/worlds?switched=${encodeURIComponent(name)}`);
}

export async function newWorldAction(id: string, _: WorldState, form: FormData): Promise<WorldState> {
  const values = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const server = await worldServer(id);
  if (typeof server === "string") return { error: server, values };
  const name = (values.name ?? "").trim();
  const seed = (values.seed ?? "").trim();
  const type = worldTypes(server.edition).find((t) => t === values.type) ?? "normal";
  if (!isValidWorldName(name)) return { error: "invalidName", values };
  if (!isValidSeed(seed)) return { error: "invalidSeed", values };
  if (await nameTaken(server, name)) return { error: "nameTaken", values };
  try {
    // An empty seed is made up here: a seed left unset would keep the last world's.
    await playWorld(server, name, { seed: seed || randomSeed(), type });
  } catch (err) {
    return { error: worldError(err), values };
  }
  revalidatePath(`/dashboard/servers/${id}`);
  redirect(`/dashboard/servers/${id}/worlds?switched=${encodeURIComponent(name)}`);
}

export async function importWorldAction(id: string, upload: string, name: string, play: boolean): Promise<WorldState> {
  const server = await worldServer(id);
  if (typeof server === "string") return { error: server };
  if (!new RegExp(`^${WORLD_UPLOAD_DIR}/[a-z0-9]{8,32}\\.zip$`).test(upload)) return { error: "failed" };
  if (!isValidWorldName(name)) {
    await agent.changeFiles(server.id, { remove: upload }).catch(() => {});
    return { error: "invalidName" };
  }
  if (await nameTaken(server, name)) {
    await agent.changeFiles(server.id, { remove: upload }).catch(() => {});
    return { error: "nameTaken" };
  }
  try {
    await agent.importWorld(server.id, server.edition, upload, name);
    if (play) {
      // Kept in the list either way: it plays once the server runs a newer version.
      if (await worldTooNew(server, name, server.version)) return { error: "worldTooNew" };
      await playWorld(server, name);
    }
  } catch (err) {
    return { error: worldError(err) };
  }
  revalidatePath(`/dashboard/servers/${id}`);
  redirect(`/dashboard/servers/${id}/worlds?${play ? "switched" : "uploaded"}=${encodeURIComponent(name)}`);
}

export async function deleteWorldAction(id: string, name: string): Promise<WorldState> {
  const server = await worldServer(id);
  if (typeof server === "string") return { error: server };
  if (!isKnownWorldName(name)) return { error: "notFound" };
  if (name === activeLevel(server)) return { error: "active" };
  try {
    await agent.deleteWorld(server.id, server.edition, name);
  } catch (err) {
    return { error: worldError(err) };
  }
  revalidatePath(`/dashboard/servers/${id}/worlds`);
  redirect(`/dashboard/servers/${id}/worlds?deleted=1`);
}
