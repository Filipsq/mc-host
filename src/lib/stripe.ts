import "server-only";
import Stripe from "stripe";

let client: Stripe | undefined;

export function stripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  if (!client) {
    // STRIPE_API_URL points the SDK at a local mock in tests; unset in production.
    const api = process.env.STRIPE_API_URL ? new URL(process.env.STRIPE_API_URL) : undefined;
    client = new Stripe(key, {
      // Pinned so a Dashboard default change can't alter webhook payloads under us.
      apiVersion: "2026-08-26.dahlia",
      ...(api && {
        host: api.hostname,
        port: Number(api.port),
        protocol: api.protocol.replace(":", "") as "http" | "https",
      }),
    });
  }
  return client;
}
