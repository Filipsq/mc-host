"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { getServerFor } from "@/lib/access";
import { applyToHost } from "@/lib/servers";
import { changeFiles } from "@/lib/agent";
import {
  PACK_FILE,
  PACK_PROMPT_MAX,
  checkPack,
  checkUploadedPack,
  directPackUrl,
  isUploadedPack,
  uploadedPackUrl,
  type PackError,
} from "@/lib/resourcePack";

export type PackState = {
  error?: PackError | "promptTooLong" | "applyFailed" | "uploadFailed" | "noSpace" | "readOnly";
  saved?: boolean;
  removed?: boolean;
};

/** Deletes an uploaded pack once nothing points to it any more; it only takes up disk space. */
async function dropUploadedFile(serverId: string) {
  await changeFiles(serverId, { remove: PACK_FILE }).catch(() => {});
}

async function javaServer(id: string) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const server = await getServerFor(id, session.user.id, "settings");
  if (!server || server.edition !== "JAVA") redirect(`/dashboard/servers/${id}`);
  return server;
}

/**
 * Checks the pack (behind the link, or the file just uploaded into the server's
 * files), saves it and rebuilds the server with it (a running one restarts).
 */
export async function savePackAction(id: string, _: PackState, form: FormData): Promise<PackState> {
  const server = await javaServer(id);
  const uploaded = form.get("source") === "upload";
  const prompt = String(form.get("prompt") ?? "").trim();
  if (prompt.length > PACK_PROMPT_MAX || /[\p{Cc}]/u.test(prompt)) return { error: "promptTooLong" };
  const checked = uploaded ? await checkUploadedPack(server.id) : await checkPack(directPackUrl(String(form.get("url") ?? "")));
  if ("error" in checked) return { error: checked.error };
  const url = uploaded ? uploadedPackUrl(server.id, checked.sha1) : directPackUrl(String(form.get("url") ?? ""));
  if (!uploaded && isUploadedPack(server.resourcePack)) await dropUploadedFile(server.id);
  const updated = await db.server.update({
    where: { id: server.id },
    data: { resourcePack: url, resourcePackSha1: checked.sha1, resourcePackRequired: form.get("required") === "on", resourcePackPrompt: prompt },
  });
  try {
    await applyToHost(updated);
  } catch (err) {
    console.error("apply resource pack failed", server.id, err);
    return { error: "applyFailed" };
  }
  revalidatePath(`/dashboard/servers/${id}`, "layout");
  return { saved: true };
}

/** Takes the pack off: players join without being asked to download anything. */
export async function removePackAction(id: string): Promise<PackState> {
  const server = await javaServer(id);
  const updated = await db.server.update({
    where: { id: server.id },
    data: { resourcePack: "", resourcePackSha1: null, resourcePackRequired: false, resourcePackPrompt: "" },
  });
  if (isUploadedPack(server.resourcePack)) await dropUploadedFile(server.id);
  try {
    await applyToHost(updated);
  } catch (err) {
    console.error("remove resource pack failed", server.id, err);
    return { error: "applyFailed" };
  }
  revalidatePath(`/dashboard/servers/${id}`, "layout");
  return { removed: true };
}
