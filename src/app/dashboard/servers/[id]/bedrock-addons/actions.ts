"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import * as agent from "@/lib/agent";
import { getServerFor } from "@/lib/access";
import { onHost } from "@/lib/servers";
import { canChangeFiles, fileError, type FileError } from "@/lib/files";
import { activeLevel } from "@/lib/worlds";
import { addonUploadPattern, takesBedrockAddons } from "@/lib/bedrockAddons";
import type { Messages } from "@/i18n/messages";

export type AddonError = keyof Messages["bedrockAddons"]["errors"] | FileError;

const PACK_ERRORS = ["noPack", "skinPack", "worldTemplate"];

async function addonServer(id: string) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const server = await getServerFor(id, session.user.id, "files");
  if (!server || !takesBedrockAddons(server)) redirect("/dashboard");
  if (!onHost(server) || !canChangeFiles(server)) return null;
  return server;
}

function addonError(err: unknown): AddonError {
  if (err instanceof agent.AgentError && PACK_ERRORS.includes(err.message)) return err.message as AddonError;
  return fileError(err);
}

/** Unpacks an uploaded .mcaddon/.mcpack into the server and turns it on in the world it runs. */
export async function installAddonAction(id: string, upload: string): Promise<{ error?: AddonError }> {
  const server = await addonServer(id);
  if (!server) return { error: "readOnly" };
  if (!addonUploadPattern.test(upload)) return { error: "failed" };
  let names: string[];
  try {
    const packs = await agent.importBedrockPacks(server.id, upload, activeLevel(server));
    names = packs.map((p) => p.name);
  } catch (err) {
    return { error: addonError(err) };
  }
  revalidatePath(`/dashboard/servers/${id}/bedrock-addons`);
  redirect(`/dashboard/servers/${id}/bedrock-addons?added=${encodeURIComponent(names.join(", ").slice(0, 300))}`);
}

export async function removeAddonAction(id: string, uuid: string): Promise<{ error?: AddonError }> {
  const server = await addonServer(id);
  if (!server) return { error: "readOnly" };
  try {
    await agent.removeBedrockPack(server.id, uuid, activeLevel(server));
  } catch (err) {
    return { error: addonError(err) };
  }
  revalidatePath(`/dashboard/servers/${id}/bedrock-addons`);
  redirect(`/dashboard/servers/${id}/bedrock-addons?removed=1`);
}
