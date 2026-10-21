"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { getOwnedServer, javaHost, syncHostAliases } from "@/lib/servers";
import { hasOwnDomain } from "@/lib/addons";
import { checkDomainShape, cleanDomain, pointsAt, type OwnDomainError } from "@/lib/ownDomain";

export type DomainState = { error?: OwnDomainError | "taken"; saved?: boolean };

async function ownedServer(id: string) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  return getOwnedServer(id, session.user.id);
}

/** Sets the server's own domain once its DNS leads to the server (the "domain" add-on). */
export async function setDomainAction(id: string, _: DomainState, form: FormData): Promise<DomainState> {
  const server = await ownedServer(id);
  if (!server || !hasOwnDomain(server)) redirect(`/dashboard/servers/${id}/addons`);
  const domain = cleanDomain(String(form.get("domain") ?? ""));
  const shape = checkDomainShape(domain);
  if (shape) return { error: shape };
  if (await db.server.count({ where: { customDomain: domain, id: { not: server.id } } })) return { error: "taken" };
  const dns = await pointsAt(domain, javaHost(server));
  if (dns) return { error: dns };
  try {
    await db.server.update({ where: { id: server.id }, data: { customDomain: domain } });
  } catch {
    // Taken by another server between the check and now.
    return { error: "taken" };
  }
  await syncHostAliases().catch((err) => console.error("host aliases not sent", err));
  revalidatePath(`/dashboard/servers/${id}/addons`);
  return { saved: true };
}

/** Goes back to the mchosting.pl address only; the add-on stays. */
export async function clearDomainAction(id: string) {
  const server = await ownedServer(id);
  if (!server) return;
  await db.server.update({ where: { id: server.id }, data: { customDomain: null } });
  await syncHostAliases().catch((err) => console.error("host aliases not sent", err));
  revalidatePath(`/dashboard/servers/${id}/addons`);
}
