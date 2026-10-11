import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { fulfillPayment, markPayment } from "@/lib/billing";

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

  const session = event.data.object as Stripe.Checkout.Session;
  const paymentId = session.metadata?.paymentId;
  switch (event.type) {
    case "checkout.session.completed":
      // "unpaid" here means a delayed method is still processing; wait for async_payment_succeeded.
      if (session.payment_status === "paid" && paymentId) await fulfillPayment(paymentId);
      break;
    case "checkout.session.async_payment_succeeded":
      if (paymentId) await fulfillPayment(paymentId);
      break;
    case "checkout.session.async_payment_failed":
      await markPayment(session.id, "FAILED");
      break;
    case "checkout.session.expired":
      await markPayment(session.id, "EXPIRED");
      break;
  }
  return Response.json({ received: true });
}
