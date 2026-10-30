import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { messages, format } from "@/i18n/messages";
import { defaultLocale, isLocale } from "@/i18n/config";
import { BRAND_NAME } from "./brand";
import { buttonMail, sendMail } from "./mail";
import { sendPush } from "./push";

// "Hey, you haven't played in a while, come back to your server": an email and
// a phone notification to owners whose servers nobody has played on for
// COMEBACK_DAYS. Once per idle stretch (Server.comebackSentAt, cleared when
// someone plays), at most one per owner at a time, and never to owners who
// turned them off with the link at the bottom of the email.

/** After how many days with nobody playing the owner is reminded. Before the free-server deletion warning. */
export const COMEBACK_DAYS = 3;

const DAY = 24 * 60 * 60 * 1000;

function sign(userId: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return createHmac("sha256", secret).update(`comeback:${userId}`).digest("base64url");
}

/** The link that turns the reminders off for this user, without signing in. */
export function unsubscribeUrl(userId: string) {
  const app = process.env.APP_URL ?? "http://localhost:3000";
  return `${app}/api/wypisz?u=${encodeURIComponent(userId)}&t=${sign(userId)}`;
}

/** Whether the token in an unsubscribe link belongs to this user. */
export function checkUnsubscribe(userId: string | null, token: string | null): userId is string {
  if (!userId || !token) return false;
  const want = Buffer.from(sign(userId));
  const got = Buffer.from(token);
  return want.length === got.length && timingSafeEqual(want, got);
}

/**
 * Reminds owners of servers nobody has played on for COMEBACK_DAYS. Called by
 * the billing job right after it noted who's playing; `unreachable` machines
 * can't say whether anyone played there, so their servers are left out.
 */
export async function sendComebackReminders(now: Date, unreachable: string[]): Promise<number> {
  const idle = await db.server.findMany({
    where: {
      status: { in: ["RUNNING", "STOPPED", "SLEEPING"] },
      lastPlayedAt: { lt: new Date(now.getTime() - COMEBACK_DAYS * DAY) },
      comebackSentAt: null,
      adminTest: false,
      node: { notIn: unreachable },
      owner: { comebackOff: false },
    },
    include: { owner: { select: { email: true, locale: true } } },
    orderBy: { lastPlayedAt: "desc" },
  });
  // One email per owner, about the server they played on most recently.
  const byOwner = new Map<string, typeof idle>();
  for (const s of idle) byOwner.set(s.ownerId, [...(byOwner.get(s.ownerId) ?? []), s]);
  let sent = 0;
  for (const [ownerId, servers] of byOwner) {
    const server = servers[0];
    const ids = servers.map((s) => s.id);
    // Claim first, so overlapping runs don't both send; give it back if sending fails.
    const claim = await db.server.updateMany({ where: { id: { in: ids }, comebackSentAt: null }, data: { comebackSentAt: now } });
    if (claim.count === 0) continue;
    const locale = isLocale(server.owner.locale) ? server.owner.locale : defaultLocale;
    const t = messages[locale].comebackMail;
    const app = process.env.APP_URL ?? "http://localhost:3000";
    const vars = { server: server.name, days: Math.floor((now.getTime() - server.lastPlayedAt.getTime()) / DAY) };
    const page = `${app}/dashboard/servers/${server.id}`;
    const mail = buttonMail({
      to: server.owner.email,
      subject: format(t.subject, vars),
      paragraphs: t.paragraphs.map((p) => format(p, vars)),
      button: t.button,
      url: page,
      footer: format(t.footer, { brand: BRAND_NAME }),
      unsubscribe: { label: t.unsubscribe, url: unsubscribeUrl(ownerId) },
    });
    try {
      await sendMail(mail);
      sent++;
      await sendPush([ownerId], { title: mail.subject, body: format(t.push, vars), url: page });
    } catch (err) {
      console.error(`[mail] comeback email for server ${server.id} failed:`, err);
      await db.server.updateMany({ where: { id: { in: ids }, comebackSentAt: now }, data: { comebackSentAt: null } });
    }
  }
  return sent;
}
