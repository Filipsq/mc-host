"use server";

import { logServerEvent } from "@/lib/serverEvents";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { REMOVABLE_PAYMENTS, TEST_PAYMENTS, adminChangePlan, giftDays } from "@/lib/billing";
import { db } from "@/lib/db";
import { ANNOUNCEMENT_MAX, sayOnAllServers, setAnnouncement } from "@/lib/announcement";
import { applyToHost, destroyServer, moveServer, onHost } from "@/lib/servers";
import { nodes } from "@/lib/nodes";
import { requiredArch } from "@/lib/terraria";
import { stripeTestMode } from "@/lib/stripe";
import { makeUpForTestPayment, untoldCustomers } from "@/lib/testPayments";
import { getPreferences } from "@/i18n/server";
import { createAdminResetLink } from "@/lib/passwordReset";
import { PLAYERS_MAX } from "@/lib/settings";
import { sendPaymentHelp } from "@/lib/paymentHelp";
import { deleteAccount } from "@/lib/accountDeletion";
import type { DeleteAccountState } from "@/components/DeleteAccountForm";
import { startServerAction } from "@/app/dashboard/servers/actions";
import { PAYMENT_PERIODS, parseDay } from "@/lib/machinePayments";

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

export type PlanChangeState = { error?: "invalid" | "noDays" | "soldOut" | "failed"; plan?: string; date?: string };

const ADMIN_PLANS = ["STARTER", "STANDARD", "PRO", "MAX"] as const;

/** Switches any server, a free one too, to a paid plan for free (see adminChangePlan). */
export async function adminChangePlanAction(id: string, _: PlanChangeState, form: FormData): Promise<PlanChangeState> {
  await requireAdmin();
  const plan = ADMIN_PLANS.find((p) => p === form.get("plan"));
  const days = Number(form.get("days"));
  if (!plan || !Number.isInteger(days) || days < 0 || days > 365) return { error: "invalid" };
  const { error, server } = await adminChangePlan(id, plan, days);
  revalidatePath(`/admin/servers/${id}`);
  const { locale } = await getPreferences();
  const date = server?.paidUntil?.toLocaleString(locale, { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Warsaw" });
  return { error, plan, date };
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

/** Deletes a customer's whole account with its servers (src/lib/accountDeletion.ts), once its email is typed again. */
export async function deleteAccountAdminAction(userId: string, _: DeleteAccountState, form: FormData): Promise<DeleteAccountState> {
  const session = await requireAdmin();
  const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) return { error: "missing" };
  if (String(form.get("email") ?? "").trim().toLowerCase() !== user.email.toLowerCase()) return { error: "email" };
  let result;
  try {
    result = await deleteAccount(userId);
  } catch (err) {
    console.error("admin: account deletion failed", userId, err);
    return { error: "failed" };
  }
  if (result === "serverFailed" || result === "admin" || result === "missing") return { error: result };
  console.info("admin deleted account", userId, result, "by", session.user?.id);
  revalidatePath("/admin/users");
  redirect("/admin/users");
}

export type SlotsState = { error?: "invalid" | "failed"; saved?: boolean };

/** Gives a server more (or fewer) player slots than its plan, without changing its RAM. Empty: the plan's limit. */
export async function playerSlotsAction(id: string, _: SlotsState, form: FormData): Promise<SlotsState> {
  await requireAdmin();
  const raw = String(form.get("slots") ?? "").trim();
  const slots = raw === "" ? null : Number(raw);
  if (slots !== null && (!Number.isInteger(slots) || slots < 1 || slots > PLAYERS_MAX)) return { error: "invalid" };
  const server = await db.server.update({ where: { id }, data: { playerSlots: slots } }).catch(() => null);
  if (!server) return { error: "invalid" };
  console.info("admin set player slots", id, slots);
  await logServerEvent(server, "slots", slots === null ? "jak w planie" : String(slots));
  revalidatePath(`/admin/servers/${id}`);
  if (onHost(server)) {
    try {
      await applyToHost(server);
    } catch (err) {
      console.error("admin: slots not applied", id, err);
      return { error: "failed" };
    }
  }
  return { saved: true };
}

export type MoveState = { error?: "invalid" | "failed"; moved?: string };

/** Moves a server, stopped, with its files and backups, to another machine (to take load off a full one). */
export async function moveServerAdminAction(id: string, _: MoveState, form: FormData): Promise<MoveState> {
  await requireAdmin();
  const to = nodes().find((n) => n.id === form.get("node"));
  const server = await db.server.findUnique({ where: { id } });
  if (!server || !to || to.id === server.node) return { error: "invalid" };
  const arch = requiredArch(server);
  if (arch && to.arch && to.arch !== arch) return { error: "invalid" };
  if (to.memoryLimitMb > 0 && server.memoryMb > to.memoryLimitMb) return { error: "invalid" };
  const moved = await moveServer(server, to.id);
  revalidatePath(`/admin/servers/${id}`);
  if (!moved) return { error: "failed" };
  console.info("admin moved server", id, "to", to.id);
  // Only its files went over: build its container there, stopped, so Start works.
  await applyToHost(moved).catch((err) => console.error("admin: container not built after move", id, err));
  return { moved: to.id };
}

export type RebuildState = { rebuilt?: number; failed?: number };

/**
 * Rebuilds the container of every Bedrock and crossplay server, so they take
 * the agent's newest Bedrock setup (NetherNet, needed from 27.10.2026). Running
 * ones restart; stopped and sleeping ones get it on their next start.
 */
export async function rebuildBedrockAction(): Promise<RebuildState> {
  await requireAdmin();
  const servers = await db.server.findMany({ where: { OR: [{ edition: "BEDROCK" }, { edition: "JAVA", crossplay: true }] } });
  let rebuilt = 0;
  let failed = 0;
  // One at a time, so the machines aren't restarting them all at once.
  for (const server of servers.filter(onHost)) {
    try {
      await applyToHost(server);
      rebuilt++;
    } catch (err) {
      console.error("admin: Bedrock rebuild failed", server.id, err);
      failed++;
    }
  }
  console.info("admin rebuilt Bedrock and crossplay servers", rebuilt, "failed", failed);
  return { rebuilt, failed };
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

const COST_CURRENCIES = ["EUR", "PLN"] as const;

/**
 * Saves each machine's price, whether it was typed with VAT, how long one payment covers, the next payment day
 * and the provider's name for it. An empty price forgets the machine.
 */
export async function saveMachineCostsAction(form: FormData) {
  await requireAdmin();
  for (const node of nodes()) {
    const raw = String(form.get(`amount_${node.id}`) ?? "").replace(/\s/g, "").replace(",", ".");
    const currency = String(form.get(`currency_${node.id}`));
    if (!raw) {
      await db.machineCost.deleteMany({ where: { node: node.id } });
      continue;
    }
    const amount = Math.round(Number(raw) * 100);
    if (!Number.isFinite(amount) || amount < 0 || amount > 10_000_000) continue;
    if (!(COST_CURRENCIES as readonly string[]).includes(currency)) continue;
    const gross = form.get(`gross_${node.id}`) === "on";
    const period = Number(form.get(`period_${node.id}`));
    const periodMonths = (PAYMENT_PERIODS as readonly number[]).includes(period) ? period : 1;
    const nextPayment = parseDay(String(form.get(`next_${node.id}`) ?? "").trim());
    const label = String(form.get(`label_${node.id}`) ?? "").trim().slice(0, 60) || null;
    const data = { amount, currency, gross, periodMonths, nextPayment, label };
    await db.machineCost.upsert({ where: { node: node.id }, create: { node: node.id, ...data }, update: data });
  }
  revalidatePath("/admin");
}

/** Asks the buyer of an unfinished payment, in the chat and by email, if they need help paying (paymentHelp.ts). */
export async function paymentHelpAction(paymentId: string) {
  const session = await requireAdmin();
  const result = await sendPaymentHelp(paymentId, session.user!.id!);
  console.info("admin payment help", paymentId, result);
  revalidatePath("/admin", "layout");
}

export type RestartResult = "started" | "queued" | "full" | "failed";

/**
 * Starts crashed servers again, one after another, e.g. after an update that
 * fixes what stopped them. The same start as the owner's Uruchom (the agent's
 * fixes run on every start); admins may start any server.
 */
export async function restartCrashedAction(ids: string[]): Promise<Record<string, RestartResult>> {
  await requireAdmin();
  const out: Record<string, RestartResult> = {};
  for (const id of ids.slice(0, 100)) {
    try {
      const r = await startServerAction(id);
      out[id] = r.queued ? "queued" : r.error === "full" ? "full" : r.error ? "failed" : "started";
    } catch (err) {
      console.error("admin: restart after crash failed", id, err);
      out[id] = "failed";
    }
  }
  revalidatePath("/admin");
  return out;
}
