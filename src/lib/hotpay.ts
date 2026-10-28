import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Payment } from "@prisma/client";
import type { Currency } from "@/i18n/config";

// paysafecard through HotPay (hotpay.pl), since Stripe doesn't take it. The
// buyer's browser posts a form to HotPay's paysafecard page (/api/hotpay/start),
// they type their code there, and HotPay posts the result to /api/hotpay/notify,
// which applies the payment as Stripe's webhook does.
//
// deploy/.env: HOTPAY_SECRET is the service's "SEKRET" and HOTPAY_PASSWORD the
// notification password ("hasło do notyfikacji") from the HotPay panel; the
// panel's notification address is https://<site>/api/hotpay/notify.

const DEFAULT_URL = "https://psc.hotpay.pl/";

/** Whether paysafecard can be offered: HotPay is set up, and the price is in złoty. */
export function paysafecardEnabled(currency: Currency | string) {
  return !!process.env.HOTPAY_SECRET && !!process.env.HOTPAY_PASSWORD && currency === "PLN";
}

const sha256 = (parts: string[]) => createHash("sha256").update(parts.join(";")).digest("hex");

/** An amount in grosze as HotPay writes it, e.g. 1500 → "15.00". */
export const hotpayAmount = (grosze: number) => (grosze / 100).toFixed(2);

/** The fields of the form that sends the buyer to HotPay to pay `payment`. */
export function hotpayForm(payment: Pick<Payment, "id" | "amount">, opts: { productName: string; returnUrl: string; email: string }) {
  const secret = process.env.HOTPAY_SECRET!;
  const fields = {
    SEKRET: secret,
    KWOTA: hotpayAmount(payment.amount),
    // HotPay keeps names short; the plan and server are what the buyer needs to recognise.
    NAZWA_USLUGI: opts.productName.slice(0, 100),
    ADRES_WWW: opts.returnUrl,
    ID_ZAMOWIENIA: payment.id,
    EMAIL: opts.email,
  };
  const hash = sha256([process.env.HOTPAY_PASSWORD!, fields.KWOTA, fields.NAZWA_USLUGI, fields.ADRES_WWW, fields.ID_ZAMOWIENIA, secret]);
  return { url: process.env.HOTPAY_URL || DEFAULT_URL, fields: { ...fields, HASH: hash } };
}

export type HotpayNotice = {
  amount: string; // KWOTA, e.g. "15.00"
  hotpayId: string; // ID_PLATNOSCI
  paymentId: string; // ID_ZAMOWIENIA
  status: "SUCCESS" | "FAILURE" | "PENDING";
};

/** A notification HotPay signed with our password, or null for anything else. */
export function readNotice(form: FormData): HotpayNotice | null {
  const get = (k: string) => String(form.get(k) ?? "");
  const [amount, hotpayId, paymentId, status, secret, hash] = ["KWOTA", "ID_PLATNOSCI", "ID_ZAMOWIENIA", "STATUS", "SEKRET", "HASH"].map(get);
  if (!process.env.HOTPAY_SECRET || !process.env.HOTPAY_PASSWORD) return null;
  if (!amount || !hotpayId || !paymentId || !hash || secret !== process.env.HOTPAY_SECRET) return null;
  if (status !== "SUCCESS" && status !== "FAILURE" && status !== "PENDING") return null;
  const expected = Buffer.from(sha256([process.env.HOTPAY_PASSWORD, amount, hotpayId, paymentId, status, secret]));
  const given = Buffer.from(hash.toLowerCase());
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return { amount, hotpayId, paymentId, status };
}

/** Whether HotPay's amount is what the payment costs. */
export function amountMatches(notice: Pick<HotpayNotice, "amount">, payment: Pick<Payment, "amount">) {
  return Math.round(Number(notice.amount.replace(",", ".")) * 100) === payment.amount;
}
