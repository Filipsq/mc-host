"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { BRAND_NAME } from "@/lib/brand";
import { normalizeGiftCode, redeemGift, startGiftCheckout } from "@/lib/gifts";
import { GIFT_COOKIE } from "@/lib/giftCookie";
import { PERIOD_DAYS, type PeriodDays } from "@/lib/periods";
import { getMessages, getPreferences } from "@/i18n/server";
import { format, type Messages } from "@/i18n/messages";

export type GiftErrorCode = keyof Messages["gifts"]["errors"];
export type BuyGiftState = { error?: GiftErrorCode };

const buySchema = z.object({
  plan: z.enum(["STARTER", "STANDARD", "PRO"]),
  days: z.coerce
    .number()
    .refine((d): d is PeriodDays => (PERIOD_DAYS as readonly number[]).includes(d))
    .transform((d) => d as PeriodDays),
});

/** Pays for a gift code; the code is made when Stripe confirms (fulfillGiftPurchase). */
export async function buyGiftAction(_: BuyGiftState, form: FormData): Promise<BuyGiftState> {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const parsed = buySchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "invalidPlan" };
  if (form.get("consent") !== "on") return { error: "consentRequired" };
  const [{ locale, currency }, t] = await Promise.all([getPreferences(), getMessages()]);
  let url: string;
  try {
    // The code's email goes out in the language it was bought in.
    await db.user.updateMany({ where: { id: session.user.id }, data: { locale } });
    url = await startGiftCheckout({
      user: { id: session.user.id, email: session.user.email ?? "" },
      plan: parsed.data.plan,
      days: parsed.data.days,
      currency,
      locale,
      productName: format(t.gifts.productName, { brand: BRAND_NAME, plan: t.plans[parsed.data.plan], days: parsed.data.days }),
    });
  } catch (err) {
    console.error("gift checkout failed", err);
    return { error: "paymentsUnavailable" };
  }
  redirect(url);
}

/**
 * "Odbierz prezent": opens the redeem page for the typed code. Someone not
 * signed in signs up or logs in first, and the code waits in a cookie.
 */
export async function lookupGiftAction(form: FormData) {
  const code = normalizeGiftCode(String(form.get("code") ?? "")).slice(0, 20);
  if (!code) redirect("/prezent");
  const session = await getSession();
  if (!session?.user?.id) {
    (await cookies()).set(GIFT_COOKIE, code, { httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 7, path: "/" });
    redirect(form.get("login") === "1" ? "/login" : "/signup");
  }
  redirect(`/prezent/odbierz?kod=${encodeURIComponent(code)}`);
}

/** Adds the gift to one of the user's servers. */
export async function redeemGiftAction(form: FormData) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const code = normalizeGiftCode(String(form.get("code") ?? "")).slice(0, 20);
  const server = await db.server.findFirst({ where: { id: String(form.get("server") ?? ""), ownerId: session.user.id } });
  const back = `/prezent/odbierz?kod=${encodeURIComponent(code)}`;
  if (!server) redirect(`${back}&blad=notFound`);
  let error: string | undefined;
  try {
    error = (await redeemGift(code, session.user.id, server)).error;
  } catch {
    error = "failed";
  }
  if (error) redirect(`${back}&blad=${error}`);
  (await cookies()).delete(GIFT_COOKIE);
  redirect(`/dashboard/servers/${server.id}?prezent=ok`);
}
