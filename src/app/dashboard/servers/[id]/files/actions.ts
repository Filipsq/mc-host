"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { getServerFor } from "@/lib/access";
import * as agent from "@/lib/agent";
import { AgentError } from "@/lib/agent";
import { canChangeFiles, fileError, type FileError } from "@/lib/files";

export type FileOp = { mkdir: string } | { newFile: string } | { rename: string; to: string } | { remove: string } | { removeMany: string[] } | { unzip: string };
export type FileResult = { error?: FileError; files?: number };

const okPath = (p: unknown): p is string => typeof p === "string" && p.length > 0 && p.length <= 1024 && !p.includes("\0");
// A folder listing shows at most 5000 entries, so "select all" never sends more.
const MAX_MANY = 5000;

/** Makes a folder, an empty file, renames or moves, deletes, or unzips something in the server's files. */
export async function fileAction(id: string, op: FileOp): Promise<FileResult> {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const server = await getServerFor(id, session.user.id, "files");
  if (!server) return { error: "notFound" };
  if (!canChangeFiles(server)) return { error: "readOnly" };
  const shape = Object.keys(op ?? {}).sort().join(",");
  if (!["mkdir", "newFile", "remove", "removeMany", "unzip", "rename,to"].includes(shape)) return { error: "badName" };
  if ("removeMany" in op) {
    const paths = op.removeMany;
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_MANY || !paths.every(okPath)) return { error: "badName" };
    return removeMany(server.id, [...new Set(paths)]);
  }
  if (!Object.values(op).every(okPath)) return { error: "badName" };
  try {
    if ("newFile" in op) {
      await createEmptyFile(server.id, op.newFile);
      revalidatePath(`/dashboard/servers/${server.id}/files`);
      return {};
    }
    const res = await agent.changeFiles(server.id, op);
    revalidatePath(`/dashboard/servers/${server.id}/files`);
    return { files: res.files };
  } catch (err) {
    return { error: fileError(err) };
  }
}

/**
 * Deletes several files and folders, a few at a time. Stops at the first error and
 * says how many went before it, so the list shows what is really left.
 */
async function removeMany(id: string, paths: string[]): Promise<FileResult> {
  let done = 0;
  let error: FileError | undefined;
  for (let i = 0; i < paths.length && !error; i += 8) {
    const results = await Promise.allSettled(paths.slice(i, i + 8).map((p) => agent.changeFiles(id, { remove: p })));
    for (const r of results) {
      const e = r.status === "rejected" ? fileError(r.reason) : null;
      if (!e || e === "notFound") done++; // already gone counts as deleted
      else error ??= e;
    }
  }
  revalidatePath(`/dashboard/servers/${id}/files`);
  return { error, files: done };
}

/** Writes an empty file, refusing to overwrite something already there. */
async function createEmptyFile(id: string, path: string) {
  const exists = await agent.openFile(id, path, { max: 1 }).then(
    async (res) => (await res.body?.cancel(), true),
    (err) => !(err instanceof AgentError && err.status === 404),
  );
  if (exists) throw new AgentError("exists", 409);
  await agent.writeFile(id, path, "", 0);
}
