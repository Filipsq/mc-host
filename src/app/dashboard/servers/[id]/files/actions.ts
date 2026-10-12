"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { getOwnedServer } from "@/lib/servers";
import * as agent from "@/lib/agent";
import { canChangeFiles, fileError, type FileError } from "@/lib/files";

export type FileOp = { mkdir: string } | { rename: string; to: string } | { remove: string } | { unzip: string };
export type FileResult = { error?: FileError; files?: number };

const okPath = (p: unknown): p is string => typeof p === "string" && p.length > 0 && p.length <= 1024 && !p.includes("\0");

/** Makes a folder, renames or moves, deletes, or unzips something in the server's files. */
export async function fileAction(id: string, op: FileOp): Promise<FileResult> {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const server = await getOwnedServer(id, session.user.id);
  if (!server) return { error: "notFound" };
  if (!canChangeFiles(server)) return { error: "readOnly" };
  const shape = Object.keys(op ?? {}).sort().join(",");
  if (!["mkdir", "remove", "unzip", "rename,to"].includes(shape) || !Object.values(op).every(okPath)) return { error: "badName" };
  try {
    const res = await agent.changeFiles(server.id, op);
    revalidatePath(`/dashboard/servers/${server.id}/files`);
    return { files: res.files };
  } catch (err) {
    return { error: fileError(err) };
  }
}
