import "server-only";
import { db } from "./db";
import { BRAND_NAME } from "./brand";
import { buttonMail, sendMail } from "./mail";
import { sendPush } from "./push";
import { postMessage } from "./support";
import { messages, format } from "@/i18n/messages";
import { defaultLocale, isLocale } from "@/i18n/config";

// A customer started a checkout and didn't finish it (the payment still
// "Oczekuje"). With one click on the admin payments page the site asks them,
// in the support chat and by email, whether they need help: maybe they were
// looking for paysafecard or another way to pay, which the admin can sort out
// with them in the chat. Each payment is asked about once (Payment.helpSentAt).

export type HelpResult = "sent" | "already" | "notPending";

export async function sendPaymentHelp(paymentId: string, adminId: string, now = new Date()): Promise<HelpResult> {
  const payment = await db.payment.findUnique({
    where: { id: paymentId },
    include: { user: { select: { id: true, email: true, locale: true } }, server: { select: { name: true } } },
  });
  if (!payment || payment.status !== "PENDING") return "notPending";
  // Claim it first, so two clicks (or two admins) send it only once.
  const claimed = await db.payment.updateMany({ where: { id: paymentId, status: "PENDING", helpSentAt: null }, data: { helpSentAt: now } });
  if (claimed.count === 0) return "already";

  const { user } = payment;
  const locale = isLocale(user.locale) ? user.locale : defaultLocale;
  const all = messages[locale];
  const t = all.paymentHelpMail;
  const plan = all.plans[payment.plan];
  const what = payment.server ? format(t.whatServer, { server: payment.server.name, plan }) : format(t.whatPlan, { plan });
  const vars = { what, brand: BRAND_NAME };
  const paragraphs = t.paragraphs.map((p) => format(p, vars));

  const chat = await postMessage(user.id, "staff", adminId, paragraphs.join("\n\n"), locale, undefined, undefined, true);
  if (!chat.ok) console.error(`[payment help] chat message for user ${user.id} failed:`, chat.error);

  const app = process.env.APP_URL ?? "http://localhost:3000";
  const url = `${app}/dashboard/support`;
  const mail = buttonMail({
    to: user.email,
    subject: format(t.subject, vars),
    paragraphs,
    button: t.button,
    url,
    footer: format(all.planMail.footer, { brand: BRAND_NAME, contact: `${app}/kontakt` }),
  });
  await sendPush([user.id], { title: mail.subject, body: paragraphs[1] ?? paragraphs[0], url });
  try {
    await sendMail(mail);
  } catch (err) {
    console.error(`[mail] payment help for user ${user.id} failed:`, err);
  }
  console.info("payment help sent", paymentId, user.id);
  return "sent";
}
