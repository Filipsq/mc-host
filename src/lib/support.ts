import "server-only";
import { after } from "next/server";
import { Prisma, type SupportChat } from "@prisma/client";
import { db } from "./db";
import { messages, format } from "@/i18n/messages";
import { defaultLocale, isLocale } from "@/i18n/config";
import { BRAND_NAME } from "./brand";
import { buttonMail, sendMail } from "./mail";
import { sendPush } from "./push";

// The "Help" chat: each user has one conversation with the admins. The pages
// poll /api/support for new messages while they're open and visible, and
// whoever isn't looking gets an email about the first unread message of a run.

/** Who is looking at a chat: its user, or an admin answering them. */
export type Side = "user" | "staff";

export const MAX_LENGTH = 2000;
/** A user may send this many messages per RATE_MINUTES. */
export const RATE_COUNT = 20;
export const RATE_MINUTES = 10;
/** How many of the latest messages a chat shows. */
export const SHOWN = 200;
/** Someone who polled the chat this recently is reading it, so they get no email. */
const READING_MS = 60_000;

export type ChatMessage = {
  id: string;
  body: string;
  fromStaff: boolean;
  /** ISO time, for ordering and polling. */
  at: string;
  /** The time as people read it, in Polish time. */
  time: string;
};

export type ChatState = { messages: ChatMessage[]; seenAt: string | null };

/** Times like "10:25" today and "12 paź, 10:25" before, formatted on the server so pages hydrate cleanly. */
function timeFormat(locale: string) {
  const zone = "Europe/Warsaw";
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: zone, dateStyle: "short" });
  const time = new Intl.DateTimeFormat(locale, { timeZone: zone, timeStyle: "short" });
  const date = new Intl.DateTimeFormat(locale, { timeZone: zone, day: "numeric", month: "short" });
  const dateYear = new Intl.DateTimeFormat(locale, { timeZone: zone, dateStyle: "medium" });
  const now = new Date();
  const today = day.format(now);
  return (d: Date) => {
    if (day.format(d) === today) return time.format(d);
    const sameYear = d.getUTCFullYear() === now.getUTCFullYear();
    return `${(sameYear ? date : dateYear).format(d)}, ${time.format(d)}`;
  };
}

/**
 * The chat's messages (the latest SHOWN, or those from `since` on) and when
 * the other side last looked at it, which shows as "Seen". Looking marks the
 * chat read for this side.
 */
export async function readChat(userId: string, side: Side, locale: string, since?: Date): Promise<ChatState> {
  const rows = await db.supportMessage.findMany({
    where: { chatId: userId, ...(since ? { createdAt: { gte: since } } : {}) },
    orderBy: { createdAt: "desc" },
    take: SHOWN,
  });
  const now = new Date();
  const chat = await db.supportChat
    .update({
      where: { userId },
      data: side === "user" ? { userUnread: 0, userReadAt: now } : { staffUnread: 0, staffReadAt: now },
    })
    .catch((err: unknown) => {
      // There's no chat until its first message.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") return null;
      throw err;
    });
  const when = timeFormat(locale);
  const seen = side === "user" ? chat?.staffReadAt : chat?.userReadAt;
  return {
    messages: rows.reverse().map((m) => ({
      id: m.id,
      body: m.body,
      fromStaff: m.fromStaff,
      at: m.createdAt.toISOString(),
      time: when(m.createdAt),
    })),
    seenAt: seen?.toISOString() ?? null,
  };
}

export type SendResult = { ok: true; message: ChatMessage } | { ok: false; error: "empty" | "tooLong" | "tooMany" };

/** Adds a message from `side` to the user's chat and emails the other side if they aren't reading it. */
export async function postMessage(userId: string, side: Side, authorId: string, text: string, locale: string): Promise<SendResult> {
  const body = text.replace(/\r\n?/g, "\n").trim();
  if (!body) return { ok: false, error: "empty" };
  if (body.length > MAX_LENGTH) return { ok: false, error: "tooLong" };
  if (side === "user") {
    const recent = await db.supportMessage.count({
      where: { chatId: userId, fromStaff: false, createdAt: { gte: new Date(Date.now() - RATE_MINUTES * 60_000) } },
    });
    if (recent >= RATE_COUNT) return { ok: false, error: "tooMany" };
  }

  const now = new Date();
  const staff = side === "staff";
  // Writing counts as reading: the writer has seen everything before it.
  const mine = staff ? { staffUnread: 0, staffReadAt: now } : { userUnread: 0, userReadAt: now };
  const [chat, message] = await db.$transaction([
    db.supportChat.upsert({
      where: { userId },
      create: { userId, lastMessageAt: now, lastFromStaff: staff, ...mine, ...(staff ? { userUnread: 1 } : { staffUnread: 1 }) },
      update: { lastMessageAt: now, lastFromStaff: staff, ...mine, ...(staff ? { userUnread: { increment: 1 } } : { staffUnread: { increment: 1 } }) },
    }),
    db.supportMessage.create({ data: { chatId: userId, fromStaff: staff, authorId, body, createdAt: now } }),
  ]);

  if (shouldEmail(chat, side, now)) after(() => notify(userId, side, body));
  return {
    ok: true,
    message: { id: message.id, body, fromStaff: staff, at: now.toISOString(), time: timeFormat(locale)(now) },
  };
}

/** Only the first unread message of a run sends an email, and only to someone not looking at the chat right now. */
function shouldEmail(chat: SupportChat, from: Side, now: Date) {
  const unread = from === "user" ? chat.staffUnread : chat.userUnread;
  const readAt = from === "user" ? chat.staffReadAt : chat.userReadAt;
  return unread === 1 && (!readAt || now.getTime() - readAt.getTime() > READING_MS);
}

async function notify(userId: string, from: Side, body: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, locale: true } });
  if (!user) return;
  const recipients =
    from === "user"
      ? await db.user.findMany({ where: { admin: true }, select: { id: true, email: true, locale: true } })
      : [user];
  const app = process.env.APP_URL ?? "http://localhost:3000";
  const preview = (body.length > 600 ? `${body.slice(0, 600)}…` : body)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (const to of recipients) {
    const all = messages[isLocale(to.locale) ? to.locale : defaultLocale];
    const t = from === "user" ? all.support.mail.toStaff : all.support.mail.toUser;
    const vars = { email: user.email, brand: BRAND_NAME };
    const url = from === "user" ? `${app}/admin/support/${userId}` : `${app}/dashboard/support`;
    const mail = buttonMail({
      to: to.email,
      subject: format(t.subject, vars),
      paragraphs: [format(t.intro, vars), ...preview],
      button: t.button,
      url,
      footer: format(all.planMail.footer, { brand: BRAND_NAME, contact: `${app}/kontakt` }),
    });
    await sendPush([to.id], { title: mail.subject, body: preview.join(" ").slice(0, 160), url });
    try {
      await sendMail(mail);
    } catch (err) {
      console.error(`[mail] support chat email to ${from === "user" ? "admin" : "user"} for chat ${userId} failed:`, err);
    }
  }
}

/** The badge in the top bar: unread replies for a user, or the number of chats waiting for an admin. */
export async function unreadCount(userId: string, admin: boolean) {
  if (admin) return db.supportChat.count({ where: { staffUnread: { gt: 0 } } });
  const chat = await db.supportChat.findUnique({ where: { userId }, select: { userUnread: true } });
  return chat?.userUnread ?? 0;
}
