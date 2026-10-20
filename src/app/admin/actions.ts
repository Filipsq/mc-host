"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { REMOVABLE_PAYMENTS, TEST_PAYMENTS, giftDays } from "@/lib/billing";
import { db } from "@/lib/db";
import { ANNOUNCEMENT_MAX, sayOnAllServers, setAnnouncement } from "@/lib/announcement";
import { applyToHost, destroyServer, moveServer } from "@/lib/servers";
import { nodes } from "@/lib/nodes";
import { TMOD_ARCH } from "@/lib/terraria";
import { stripeTestMode } from "@/lib/stripe";
import { makeUpForTestPayment, untoldCustomers } from "@/lib/testPayments";
import { getPreferences } from "@/i18n/server";
import { createAdminResetLink } from "@/lib/passwordReset";

export type GiftState = { error?: "invalid" | "free" | "soldOut" | "failed"; days?: number; date?: string };

/** Extends a paid server's period for free (see giftDays). */
export async function giftDaysAction(id: string, _: GiftState, form: FormData): Promise<GiftState> {
  await requireAdmin();
  const days = Number(form.get("days"));
  if (!Number.isInteger(days) || days < 1 || days > 365) return { error: "invalid" };
  const { error, server } = await giftDays(id, days);
  revalidatePath(`/admin/servers/${id}`);
  const { locale } = await getPreferences();
  const date = server?.paidUntil?.toLocaleString(locale, { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Warsaw" });
  return { error, days, date };
}

export async function deleteServerAdminAction(id: string): Promise<{ error?: "failed" }> {
  await requireAdmin();
  const server = await db.server.findUnique({ where: { id }, select: { id: true } });
  if (server) {
    try {
      await destroyServer(server);
    } catch (err) {
      console.error("admin: delete failed", id, err);
      return { error: "failed" };
    }
    console.info("admin deleted server", id);
  }
  redirect("/admin/servers");
}

export type MoveState = { error?: "invalid" | "failed"; moved?: string };

/** Moves a server, stopped, with its files and backups, to another machine (to take load off a full one). */
export async function moveServerAdminAction(id: string, _: MoveState, form: FormData): Promise<MoveState> {
  await requireAdmin();
  const to = nodes().find((n) => n.id === form.get("node"));
  const server = await db.server.findUnique({ where: { id } });
  if (!server || !to || to.id === server.node) return { error: "invalid" };
  if (server.edition === "TERRARIA" && server.kind === "tmodloader" && to.arch && to.arch !== TMOD_ARCH) return { error: "invalid" };
  if (to.memoryLimitMb > 0 && server.memoryMb > to.memoryLimitMb) return { error: "invalid" };
  const moved = await moveServer(server, to.id);
  revalidatePath(`/admin/servers/${id}`);
  if (!moved) return { error: "failed" };
  console.info("admin moved server", id, "to", to.id);
  // Only its files went over: build its container there, stopped, so Start works.
  await applyToHost(moved).catch((err) => console.error("admin: container not built after move", id, err));
  return { moved: to.id };
}

/** Deletes one test, failed or expired payment from the history. */
export async function deletePaymentAction(id: string) {
  await requireAdmin();
  const { count } = await db.payment.deleteMany({ where: { AND: [{ id }, REMOVABLE_PAYMENTS] } });
  if (count > 0) console.info("admin deleted payment", id);
  revalidatePath("/admin", "layout");
}

/** Deletes every payment made with Stripe test keys. */
export async function deleteTestPaymentsAction() {
  await requireAdmin();
  // They're the only record of whose payment didn't go through, until everyone is told.
  if ((await untoldCustomers()).length > 0) return;
  const { count } = await db.payment.deleteMany({ where: TEST_PAYMENTS });
  console.info("admin deleted test payments", count);
  revalidatePath("/admin", "layout");
}

/**
 * Tells one customer (or, without an id, every one not told yet) that their
 * test payment took no money, and makes up for it (src/lib/testPayments.ts).
 * Only on the live keys: the email asks them to pay again.
 */
export async function apologizeForTestPaymentsAction(userId?: string) {
  await requireAdmin();
  if (stripeTestMode()) return;
  const ids = userId ? [userId] : (await untoldCustomers()).map((u) => u.id);
  let told = 0;
  for (const id of ids) if (await makeUpForTestPayment(id)) told++;
  console.info("admin sent test payment apologies", told);
  revalidatePath("/admin", "layout");
}

export type AnnouncementState = { error?: "tooLong"; saved?: boolean; cleared?: boolean; sent?: number };

/** Saves the site-wide notice, and with "inGame" also says it on every server that's on. */
export async function saveAnnouncementAction(_: AnnouncementState, form: FormData): Promise<AnnouncementState> {
  await requireAdmin();
  const text = String(form.get("text") ?? "").trim();
  if (text.length > ANNOUNCEMENT_MAX) return { error: "tooLong" };
  await setAnnouncement(text);
  revalidatePath("/", "layout");
  console.info("admin set announcement", JSON.stringify(text));
  if (!text) return { cleared: true };
  const sent = form.get("inGame") === "on" ? await sayOnAllServers(text) : undefined;
  return { saved: true, sent };
}

/** A one-time link to set a new password, for the admin to send the customer when the email doesn't arrive. */
export async function resetLinkAdminAction(userId: string): Promise<{ url?: string; error?: "failed" }> {
  await requireAdmin();
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
  if (!user) return { error: "failed" };
  const url = await createAdminResetLink(user.id);
  console.log(`[admin] password link created for ${user.email}`);
  return { url };
}
