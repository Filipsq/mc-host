"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { getPreferences } from "@/i18n/server";
import { credentialsSchema } from "@/lib/credentials";
import { getServerFor, inviteFriend, isPerm, type InviteError } from "@/lib/access";

export type InviteState = { error?: InviteError; sent?: string; email?: string };

async function userId() {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  return session.user.id;
}

/** The server, if the signed-in user may decide who else gets in (its owner, or an admin). */
async function managedServer(id: string) {
  const server = await getServerFor(id, await userId(), "owner");
  if (!server) throw new Error("Server not found");
  return server;
}

const permsFrom = (form: FormData) => [...new Set(form.getAll("perms").filter(isPerm))];

export async function inviteFriendAction(id: string, _: InviteState, form: FormData): Promise<InviteState> {
  const server = await managedServer(id);
  const raw = String(form.get("email") ?? "").trim();
  const parsed = credentialsSchema.shape.email.safeParse(raw);
  if (!parsed.success) return { error: "invalidEmail", email: raw };
  const { locale } = await getPreferences();
  const error = await inviteFriend(server, parsed.data, permsFrom(form), locale);
  if (error) return { error, email: raw };
  revalidatePath(`/dashboard/servers/${id}/access`);
  return { sent: parsed.data };
}

/** Changes what a friend may do. */
export async function updateFriendAction(id: string, memberId: string, form: FormData) {
  const server = await managedServer(id);
  await db.serverMember.updateMany({ where: { id: memberId, serverId: server.id }, data: { perms: permsFrom(form) } });
  revalidatePath(`/dashboard/servers/${id}/access`);
}

export async function removeFriendAction(id: string, memberId: string) {
  const server = await managedServer(id);
  await db.serverMember.deleteMany({ where: { id: memberId, serverId: server.id } });
  revalidatePath(`/dashboard/servers/${id}/access`);
}

/** A friend drops a server they were let into. */
export async function leaveServerAction(id: string) {
  await db.serverMember.deleteMany({ where: { serverId: id, userId: await userId() } });
  redirect("/dashboard");
}
