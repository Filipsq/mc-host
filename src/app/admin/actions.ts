"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { REMOVABLE_PAYMENTS, TEST_PAYMENTS, giftDays } from "@/lib/billing";
import { db } from "@/lib/db";
import { destroyServer } from "@/lib/servers";
import { stripeTestMode } from "@/lib/stripe";
import { makeUpForTestPayment, untoldCustomers } from "@/lib/testPayments";
import { getPreferences } from "@/i18n/server";

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
