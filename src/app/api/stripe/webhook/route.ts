import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { applyDispute, applyRefund, fulfillPayment, markPayment, markProcessing } from "@/lib/billing";

const intentId = (pi: string | { id: string } | null) => (typeof pi === "string" ? pi : pi?.id);

// Stripe calls this after Checkout. BLIK and Przelewy24 can confirm later than
// the redirect, so the server is only provisioned from here, never from the
// success page.
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response("Webhook secret not configured", { status: 500 });

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(await req.text(), req.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const paymentId = session.metadata?.paymentId;
      // "unpaid" here means a delayed method is still processing; wait for async_payment_succeeded.
      if (session.payment_status === "paid" && paymentId) await fulfillPayment(paymentId, intentId(session.payment_intent));
      else if (paymentId) await markProcessing(paymentId);
      break;
    }
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object;
      if (session.metadata?.paymentId) await fulfillPayment(session.metadata.paymentId, intentId(session.payment_intent));
      break;
    }
    case "checkout.session.async_payment_failed":
      await markPayment(event.data.object.id, "FAILED");
      break;
    case "checkout.session.expired":
      await markPayment(event.data.object.id, "EXPIRED");
      break;
    case "charge.refunded": {
      const charge = event.data.object;
      const pi = intentId(charge.payment_intent);
      if (pi) await applyRefund(pi, charge.amount_refunded);
      break;
    }
    case "charge.dispute.created": {
      const pi = intentId(event.data.object.payment_intent);
      if (pi) await applyDispute(pi);
      break;
    }
  }
  return Response.json({ received: true });
}
