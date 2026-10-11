"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import * as agent from "@/lib/agent";
import { createServerRecord, getOwnedServer } from "@/lib/servers";
import { planById } from "@/lib/plans";
import type { Messages } from "@/i18n/messages";

export type ServerErrorCode = keyof Messages["server"]["errors"];
export type CreateServerState = { error?: ServerErrorCode; name?: string };

const createSchema = z.object({
  name: z
    .string()
    .trim()
    .regex(/^[\p{L}\p{N} _-]{3,32}$/u),
  edition: z.enum(["JAVA", "BEDROCK"]),
});

async function requireUserId() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session.user.id;
}

export async function createServerAction(_: CreateServerState, form: FormData): Promise<CreateServerState> {
  const userId = await requireUserId();
  const parsed = createSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const field = parsed.error.issues[0].path[0];
    return { error: field === "edition" ? "invalidEdition" : "invalidName", name: String(form.get("name") ?? "") };
  }
  const { name, edition } = parsed.data;

  // Paid plans need billing first, so every server is on the free plan for now.
  const plan = planById("FREE");
  if (await db.server.count({ where: { ownerId: userId, plan: "FREE" } })) {
    return { error: "freeLimit", name };
  }

  const server = await createServerRecord({
    ownerId: userId,
    name,
    edition,
    plan: plan.id,
    memoryMb: plan.ramGb * 1024,
    status: "PROVISIONING",
  });
  if (!server) return { error: "noPorts", name };

  try {
    await agent.createServer({
      id: server.id,
      name,
      edition,
      memoryMb: server.memoryMb,
      cpus: plan.cpus,
      port: server.port!,
      maxPlayers: plan.maxPlayers ?? 0,
      version: server.version,
    });
  } catch (err) {
    console.error("create server failed", server.id, err);
    // Clean up anything half-created so the user can try again.
    await agent.deleteServer(server.id).catch(() => {});
    await db.server.delete({ where: { id: server.id } });
    return { error: "agentUnavailable", name };
  }

  await db.server.update({ where: { id: server.id }, data: { status: "RUNNING" } });
  redirect(`/dashboard/servers/${server.id}`);
}

async function ownedOrThrow(id: string) {
  const server = await getOwnedServer(id, await requireUserId());
  if (!server) throw new Error("Server not found");
  return server;
}

export async function startServerAction(id: string) {
  const server = await ownedOrThrow(id);
  await agent.startServer(server.id);
  await db.server.update({ where: { id: server.id }, data: { status: "RUNNING" } });
  revalidatePath(`/dashboard/servers/${id}`);
}

export async function stopServerAction(id: string) {
  const server = await ownedOrThrow(id);
  await agent.stopServer(server.id);
  await db.server.update({ where: { id: server.id }, data: { status: "STOPPED" } });
  revalidatePath(`/dashboard/servers/${id}`);
}

export async function deleteServerAction(id: string) {
  const server = await ownedOrThrow(id);
  await agent.deleteServer(server.id);
  await db.server.delete({ where: { id: server.id } });
  redirect("/dashboard");
}

export type CommandResult = { output?: string; error?: ServerErrorCode };

export async function sendCommandAction(id: string, command: string): Promise<CommandResult> {
  const server = await ownedOrThrow(id);
  const trimmed = command.trim().replace(/^\//, "");
  if (!trimmed || trimmed.length > 500) return { error: "commandFailed" };
  try {
    return { output: await agent.sendCommand(server.id, trimmed) };
  } catch (err) {
    if (err instanceof agent.AgentError && err.status === 409) return { error: "notRunning" };
    console.error("command failed", server.id, err);
    return { error: "commandFailed" };
  }
}
