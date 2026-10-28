import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { hotpayForm, paysafecardEnabled } from "@/lib/hotpay";
import { getMessages } from "@/i18n/server";
import { format } from "@/i18n/messages";

export const dynamic = "force-dynamic";

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Sends the buyer on to HotPay's paysafecard page. HotPay takes a posted form
 * rather than a link, so this is a page that posts it straight away.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const { id } = await params;
  const payment = session?.user?.id
    ? await db.payment.findFirst({
        where: { id, userId: session.user.id, paysafecard: true, status: "PENDING" },
        include: { server: { select: { id: true, name: true } }, user: { select: { email: true } } },
      })
    : null;
  if (!payment?.server || !paysafecardEnabled(payment.currency)) return new Response("Not found", { status: 404 });

  const t = await getMessages();
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const { url, fields } = hotpayForm(payment, {
    productName: format(t.billing.productName, { plan: t.plans[payment.plan], server: payment.server.name, days: payment.days }),
    // HotPay sends the buyer back here; the plan is applied from the notification, as with Stripe.
    returnUrl: `${appUrl}/dashboard/servers/${payment.server.id}?payment=success`,
    email: payment.user.email,
  });
  const inputs = Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${escape(v)}">`)
    .join("");
  const html = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>paysafecard</title></head>
<body style="font-family:system-ui,sans-serif;text-align:center;padding:3rem 1rem">
<form id="pay" method="post" action="${escape(url)}">${inputs}<p>${escape(t.billing.redirecting)}</p><noscript><button type="submit">${escape(t.billing.paysafecard)}</button></noscript></form>
<script>document.getElementById("pay").submit()</script>
</body></html>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
