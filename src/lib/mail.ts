import "server-only";
import { BRAND_NAME } from "@/lib/brand";
import { siteHost } from "@/lib/company";

export type Mail = { to: string; subject: string; text: string; html: string; headers?: Record<string, string> };

// Sends through Brevo's HTTPS API, which also works where a host blocks
// outgoing mail ports (Hetzner does on new accounts). Without BREVO_API_KEY
// nothing is sent and the message goes to the log instead, so a reset link
// can still be found with `docker compose logs web`.
export async function sendMail(mail: Mail): Promise<void> {
  const key = process.env.BREVO_API_KEY;
  if (!key) {
    console.warn(`[mail] BREVO_API_KEY is not set, so this was not sent to ${mail.to}: ${mail.subject}\n${mail.text}`);
    return;
  }
  const res = await fetch(`${process.env.BREVO_API_URL ?? "https://api.brevo.com"}/v3/smtp/email`, {
    method: "POST",
    headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { name: BRAND_NAME, email: process.env.MAIL_FROM || `no-reply@${siteHost()}` },
      to: [{ email: mail.to }],
      subject: mail.subject,
      textContent: mail.text,
      htmlContent: mail.html,
      ...(mail.headers && { headers: mail.headers }),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Brevo answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * A plain email with one button: the same text as `paragraphs`, with the link as a button.
 * With `unsubscribe`, it ends with that link and mail apps show their own unsubscribe button.
 */
export function buttonMail(o: {
  to: string;
  subject: string;
  paragraphs: string[];
  button: string;
  url: string;
  footer: string;
  unsubscribe?: { label: string; url: string };
}): Mail {
  const u = o.unsubscribe;
  const text = [...o.paragraphs, o.url, o.footer, ...(u ? [`${u.label}: ${u.url}`] : [])].join("\n\n");
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">
<p style="margin:0 0 20px;font-size:20px;font-weight:bold">${escape(BRAND_NAME)}</p>
${o.paragraphs.map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.5">${escape(p)}</p>`).join("\n")}
<p style="margin:24px 0"><a href="${escape(o.url)}" style="display:inline-block;background:#5bc236;color:#0b0f14;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px">${escape(o.button)}</a></p>
<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#52525b;word-break:break-all">${escape(o.url)}</p>
<p style="margin:0;font-size:13px;line-height:1.5;color:#52525b">${escape(o.footer)}</p>
${u ? `<p style="margin:16px 0 0;font-size:13px;line-height:1.5"><a href="${escape(u.url)}" style="color:#52525b">${escape(u.label)}</a></p>` : ""}
</div></body></html>`;
  // One-click unsubscribe (RFC 8058): Gmail and others POST to the link themselves.
  const headers = u ? { "List-Unsubscribe": `<${u.url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined;
  return { to: o.to, subject: o.subject, text, html, headers };
}
