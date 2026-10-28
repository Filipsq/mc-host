import { db } from "@/lib/db";
import { fulfillPayment } from "@/lib/billing";
import { amountMatches, readNotice } from "@/lib/hotpay";

export const dynamic = "force-dynamic";

// HotPay posts here once a paysafecard payment is decided (src/lib/hotpay.ts).
// Set as the notification address in the HotPay panel.
export async function POST(req: Request) {
  const notice = readNotice(await req.formData().catch(() => new FormData()));
  if (!notice) return new Response("Invalid signature", { status: 400 });

  const payment = await db.payment.findFirst({ where: { id: notice.paymentId, paysafecard: true } });
  if (!payment) return new Response("Unknown payment", { status: 404 });

  if (notice.status === "SUCCESS") {
    if (!amountMatches(notice, payment)) {
      console.error("hotpay amount differs", payment.id, notice.amount, payment.amount);
      return new Response("Wrong amount", { status: 400 });
    }
    // Set first, so the admin's lists count it as a real payment.
    await db.payment.updateMany({ where: { id: payment.id, hotpayId: null }, data: { hotpayId: notice.hotpayId } });
    await fulfillPayment(payment.id);
  } else if (notice.status === "FAILURE") {
    await db.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "FAILED" } });
  }
  return new Response("OK");
}
