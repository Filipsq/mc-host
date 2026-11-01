"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getServerFor } from "@/lib/access";
import { setLinks } from "@/lib/links";

/** Puts this server in one group with the servers ticked on the page (none: takes it out). */
export async function saveLinksAction(id: string, form: FormData) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const server = await getServerFor(id, session.user.id, "owner");
  if (!server || server.edition !== "JAVA") redirect(`/dashboard/servers/${id}`);
  let done = "saved";
  try {
    await setLinks(server.ownerId, server.id, form.getAll("server").map(String));
  } catch (err) {
    console.error("save links failed", id, err);
    done = "failed";
  }
  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/servers/${id}/links?done=${done}`);
}
