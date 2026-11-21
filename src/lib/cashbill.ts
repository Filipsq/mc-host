import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Payment } from "@prisma/client";
import type { Currency } from "@/i18n/config";

// CashBill (cashbill.pl, "Web Service" REST) is the main way to pay: BLIK,
// Visa/Mastercard and bank transfers, on CashBill's own payment page (the
// buyer picks the method there). It costs far less than Stripe on small
// amounts. Stripe is left only for payments in other currencies and for
// cards saved for automatic renewal before the switch (renewal.ts): CashBill
// can't charge a saved card. startCheckout asks CashBill for a payment page and sends the
// buyer there; when the payment's status changes CashBill calls
// /api/cashbill/notify, which reads the payment back from CashBill and applies
// it as Stripe's webhook does.
//
// deploy/.env: CASHBILL_SHOP_ID is the payment point's id ("identyfikator
// punktu płatności") and CASHBILL_SECRET its key from the CashBill panel.

const API = "https://pay.cashbill.pl/ws/rest";
const TEST_API = "https://pay.cashbill.pl/testws/rest";

function config() {
  const shopId = process.env.CASHBILL_SHOP_ID;
  const secret = process.env.CASHBILL_SECRET;
  if (!shopId || !secret) throw new Error("CashBill is not set up");
  // CASHBILL_TEST=1 uses CashBill's test environment, where nobody pays.
  return { shopId, secret, api: process.env.CASHBILL_TEST === "1" ? TEST_API : API };
}

/**
 * Whether a payment goes through CashBill: it is set up, and the price is in
 * złoty. PAYMENTS_PROVIDER=stripe in deploy/.env sends everything back to
 * Stripe (only while Stripe is still there).
 */
export function cashbillEnabled(currency: Currency | string) {
  return (
    !!process.env.CASHBILL_SHOP_ID && !!process.env.CASHBILL_SECRET && currency === "PLN" && process.env.PAYMENTS_PROVIDER !== "stripe"
  );
}

/** The older name of cashbillEnabled. */
export const paysafecardEnabled = cashbillEnabled;

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

/** An amount in grosze as CashBill writes it, e.g. 1500 → "15.00". */
const cashbillAmount = (grosze: number) => (grosze / 100).toFixed(2);

/** Makes CashBill's payment page for `payment`; returns CashBill's id and the page's address. */
export async function createCashbillPayment(
  payment: Pick<Payment, "id" | "amount" | "currency">,
  opts: { title: string; returnUrl: string; email: string },
) {
  const { shopId, secret, api } = config();
  const fields = {
    title: opts.title.slice(0, 100),
    "amount.value": cashbillAmount(payment.amount),
    "amount.currencyCode": payment.currency,
    returnUrl: opts.returnUrl,
    description: opts.title.slice(0, 100),
    negativeReturnUrl: "",
    additionalData: payment.id,
    // Empty: the buyer picks BLIK, a card or a bank transfer on CashBill's page.
    paymentChannel: process.env.CASHBILL_CHANNEL ?? "",
    languageCode: "PL",
    referer: "",
    "personalData.email": opts.email,
  };
  // The sign covers every field in this order (empty ones too), then the key.
  const sign = sha1(Object.values(fields).join("") + secret);
  const body = new URLSearchParams(Object.entries({ ...fields, sign }).filter(([, v]) => v !== ""));
  const res = await fetch(`${api}/payment/${shopId}`, { method: "POST", body, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`CashBill payment not created: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { id: string; redirectUrl: string };
  return { id: data.id, url: data.redirectUrl };
}

/** Whether a notification really comes from CashBill: md5(cmd + args + key). */
export function verifyNotice(cmd: string, args: string, sign: string) {
  const { secret } = config();
  const expected = Buffer.from(md5(cmd + args + secret));
  const given = Buffer.from(sign.toLowerCase());
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type CashbillPayment = {
  id: string;
  status: string; // "PositiveFinish" once paid; see isPaid/isFailed
  additionalData?: string; // our Payment id
  amount: { value: number; currencyCode: string };
};

/** The payment as CashBill has it now. */
export async function readCashbillPayment(id: string): Promise<CashbillPayment> {
  const { shopId, secret, api } = config();
  const res = await fetch(`${api}/payment/${shopId}/${encodeURIComponent(id)}?sign=${sha1(id + secret)}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`CashBill payment not read: ${res.status}`);
  return (await res.json()) as CashbillPayment;
}

export const isPaid = (p: Pick<CashbillPayment, "status">) => p.status === "PositiveFinish";
export const isFailed = (p: Pick<CashbillPayment, "status">) =>
  ["NegativeAuthorization", "Abort", "Fraud", "NegativeFinish", "TimeExceeded", "CriticalError"].includes(p.status);

/** Whether CashBill took what the payment costs. */
export function amountMatches(cb: Pick<CashbillPayment, "amount">, payment: Pick<Payment, "amount" | "currency">) {
  return Math.round(Number(cb.amount.value) * 100) === payment.amount && cb.amount.currencyCode === payment.currency;
}
