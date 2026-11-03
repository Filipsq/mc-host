import { db } from "@/lib/db";
import { fulfillPayment } from "@/lib/billing";
import { amountMatches, isFailed, isPaid, readCashbillPayment, verifyNotice } from "@/lib/cashbill";

export const dynamic = "force-dynamic";

// CashBill calls this ("adres serwerowego potwierdzenia transakcji") when a
// paysafecard payment's status changes (src/lib/cashbill.ts). The call only
// names the payment, so its status is read back from CashBill.
async function handle(params: URLSearchParams) {
  const cmd = params.get("cmd") ?? "";
  const id = params.get("args") ?? "";
  if (!cmd || !id || !verifyNotice(cmd, id, params.get("sign") ?? "")) return new Response("Invalid signature", { status: 400 });
  if (cmd !== "transactionStatusChanged") return new Response("OK");

  const payment = await db.payment.findUnique({ where: { cashbillId: id } });
  if (!payment) return new Response("Unknown payment", { status: 404 });
  const cb = await readCashbillPayment(id);
  if (cb.additionalData && cb.additionalData !== payment.id) return new Response("Unknown payment", { status: 404 });

  if (isPaid(cb)) {
    if (!amountMatches(cb, payment)) {
      console.error("cashbill amount differs", payment.id, cb.amount, payment.amount);
      return new Response("Wrong amount", { status: 400 });
    }
    await fulfillPayment(payment.id);
  } else if (isFailed(cb)) {
    await db.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "FAILED" } });
  }
  // CashBill keeps calling until it gets OK.
  return new Response("OK");
}

export async function GET(req: Request) {
  return handle(new URL(req.url).searchParams);
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => new FormData());
  const params = new URLSearchParams(new URL(req.url).searchParams);
  for (const [k, v] of form) params.set(k, String(v));
  return handle(params);
}
