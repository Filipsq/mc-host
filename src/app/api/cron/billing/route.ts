import { runBillingJob } from "@/lib/billing";

// Call every few minutes from a scheduler (cron, systemd timer, Vercel Cron)
// with "Authorization: Bearer $CRON_SECRET".
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  return Response.json(await runBillingJob());
}
