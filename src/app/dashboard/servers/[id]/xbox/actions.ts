"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { getServerFor } from "@/lib/access";
import { AgentError, disableXbox, enableXbox } from "@/lib/agent";
import { xboxAllowed } from "@/lib/xbox";

export type XboxActionState = { error?: "notAllowed" | "failed" };

async function ownServer(id: string) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const server = await getServerFor(id, session.user.id, "owner");
  if (!server) redirect(`/dashboard/servers/${id}`);
  return server;
}

/** Starts the console sign-in; the page then shows the code to sign in with. */
export async function enableXboxAction(id: string): Promise<XboxActionState> {
  const server = await ownServer(id);
  if (!xboxAllowed(server)) return { error: "notAllowed" };
  await db.server.update({ where: { id: server.id }, data: { xbox: true } });
  try {
    await enableXbox(server.id);
  } catch (err) {
    // Not made on its machine yet (never started): it starts with the server.
    if (!(err instanceof AgentError && err.status === 404 && err.message === "server not found")) {
      console.error("xbox enable failed", server.id, err);
      await db.server.update({ where: { id: server.id }, data: { xbox: false } });
      return { error: "failed" };
    }
  }
  revalidatePath(`/dashboard/servers/${id}/xbox`);
  return {};
}

/** Turns it off and signs the account out. */
export async function disableXboxAction(id: string): Promise<XboxActionState> {
  const server = await ownServer(id);
  await db.server.update({ where: { id: server.id }, data: { xbox: false } });
  try {
    await disableXbox(server.id);
  } catch (err) {
    console.error("xbox disable failed", server.id, err);
    return { error: "failed" };
  }
  revalidatePath(`/dashboard/servers/${id}/xbox`);
  return {};
}
