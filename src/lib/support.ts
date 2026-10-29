import "server-only";
import { after } from "next/server";
import type { SupportChat } from "@prisma/client";
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
/** Pictures: the biggest file accepted, and how many a user may send per RATE_MINUTES. */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_RATE_COUNT = 10;
/** The limits the chat window tells people about. */
export type ChatRate = { count: number; minutes: number; images: number; imageMb: number };
export const CHAT_RATE: ChatRate = { count: RATE_COUNT, minutes: RATE_MINUTES, images: IMAGE_RATE_COUNT, imageMb: IMAGE_MAX_BYTES / 1024 / 1024 };
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
  /** Where the attached picture loads from, if there is one. */
  image?: string;
};

/** `deleted` lists messages an admin removed since the poll's `since`, which open chats drop. */
export type ChatState = { messages: ChatMessage[]; seenAt: string | null; deleted?: string[] };

export const imageUrl = (id: string) => `/api/support/image/${id}`;

/**
 * The picture's type from its first bytes, so a file that only claims to be an
 * image (an SVG or an HTML page, say) is refused. Only formats browsers show
 * as plain pictures.
 */
export function imageType(data: Uint8Array): string | null {
  const at = (i: number, ...bytes: number[]) => bytes.every((b, j) => data[i + j] === b);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}

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

/** How often an open chat's poll refreshes its read time while there's nothing new to mark read. */
const READ_REFRESH_MS = 20_000;

/**
 * The chat's messages (the latest SHOWN, or those from `since` on) and when
 * the other side last looked at it, which shows as "Seen". Looking marks the
 * chat read for this side, unless `peek` is set (the help bubble loading the
 * chat ahead of a click).
 */
export async function readChat(userId: string, side: Side, locale: string, since?: Date, peek = false): Promise<ChatState> {
  const [rows, gone, chat] = await Promise.all([
    db.supportMessage.findMany({
      where: { chatId: userId, deletedAt: null, ...(since ? { createdAt: { gte: since } } : {}) },
      orderBy: { createdAt: "desc" },
      take: SHOWN,
      include: { image: { select: { id: true } } },
    }),
    // Deleted after the poller's newest message, so it may still be showing it.
    since
      ? db.supportMessage.findMany({ where: { chatId: userId, deletedAt: { gte: since } }, select: { id: true } })
      : [],
    // There's no chat until its first message.
    db.supportChat.findUnique({ where: { userId } }),
  ]);
  if (chat && !peek) {
    // Writes are what's slow on a busy machine, so a poll only writes when it has
    // something to mark read, and otherwise refreshes the read time (which stops
    // emails to someone reading) every READ_REFRESH_MS, after answering.
    const unread = side === "user" ? chat.userUnread : chat.staffUnread;
    const readAt = side === "user" ? chat.userReadAt : chat.staffReadAt;
    const mark = () =>
      db.supportChat.update({
        where: { userId },
        data: side === "user" ? { userUnread: 0, userReadAt: new Date() } : { staffUnread: 0, staffReadAt: new Date() },
      });
    if (unread > 0) await mark();
    else if (!readAt || Date.now() - readAt.getTime() > READ_REFRESH_MS) after(() => mark().then(() => {}, () => {}));
  }
  const when = timeFormat(locale);
  const seen = side === "user" ? chat?.staffReadAt : chat?.userReadAt;
  return {
    messages: rows.reverse().map((m) => ({
      id: m.id,
      body: m.body,
      fromStaff: m.fromStaff,
      at: m.createdAt.toISOString(),
      time: when(m.createdAt),
      ...(m.image ? { image: imageUrl(m.image.id) } : {}),
    })),
    seenAt: seen?.toISOString() ?? null,
    ...(since ? { deleted: gone.map((m) => m.id) } : {}),
  };
}

export type SendError = "empty" | "tooLong" | "tooMany" | "imageTooBig" | "imageType" | "imageTooMany";
export type SendResult = { ok: true; message: ChatMessage } | { ok: false; error: SendError };

/**
 * Adds a message from `side` to the user's chat, with an optional picture,
 * and emails the other side if they aren't reading it.
 */
export async function postMessage(
  userId: string,
  side: Side,
  authorId: string,
  text: string,
  locale: string,
  picture?: Uint8Array,
): Promise<SendResult> {
  const body = text.replace(/\r\n?/g, "\n").trim();
  if (!body && !picture) return { ok: false, error: "empty" };
  if (body.length > MAX_LENGTH) return { ok: false, error: "tooLong" };
  const type = picture ? imageType(picture) : null;
  if (picture && picture.byteLength > IMAGE_MAX_BYTES) return { ok: false, error: "imageTooBig" };
  if (picture && !type) return { ok: false, error: "imageType" };
  if (side === "user") {
    const recentWhere = { chatId: userId, fromStaff: false, createdAt: { gte: new Date(Date.now() - RATE_MINUTES * 60_000) } };
    const recent = await db.supportMessage.count({ where: recentWhere });
    if (recent >= RATE_COUNT) return { ok: false, error: "tooMany" };
    if (picture && (await db.supportMessage.count({ where: { ...recentWhere, image: { isNot: null } } })) >= IMAGE_RATE_COUNT) {
      return { ok: false, error: "imageTooMany" };
    }
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
    db.supportMessage.create({
      data: {
        chatId: userId,
        fromStaff: staff,
        authorId,
        body,
        createdAt: now,
        ...(picture && type ? { image: { create: { type, size: picture.byteLength, data: picture } } } : {}),
      },
      include: { image: { select: { id: true } } },
    }),
  ]);

  if (shouldEmail(chat, side, now)) after(() => notify(userId, side, body, !!picture));
  return {
    ok: true,
    message: {
      id: message.id,
      body,
      fromStaff: staff,
      at: now.toISOString(),
      time: timeFormat(locale)(now),
      ...(message.image ? { image: imageUrl(message.image.id) } : {}),
    },
  };
}

/**
 * An admin removes a message from a chat: its text and picture are erased and
 * it disappears from both sides. Returns false if there was no such message.
 */
export async function deleteMessage(userId: string, messageId: string) {
  const message = await db.supportMessage.findFirst({ where: { id: messageId, chatId: userId, deletedAt: null } });
  if (!message) return false;
  const chat = await db.supportChat.findUnique({ where: { userId } });
  // A message nobody has read yet no longer counts as unread.
  const readAt = message.fromStaff ? chat?.userReadAt : chat?.staffReadAt;
  const unread = !readAt || readAt < message.createdAt;
  const counter = message.fromStaff ? "userUnread" : "staffUnread";
  await db.$transaction([
    db.supportImage.deleteMany({ where: { messageId } }),
    db.supportMessage.update({ where: { id: messageId }, data: { body: "", deletedAt: new Date() } }),
    ...(unread && chat && chat[counter] > 0
      ? [db.supportChat.update({ where: { userId }, data: { [counter]: { decrement: 1 } } })]
      : []),
  ]);
  // The chat waits for an answer only if what's left ends with the user's message.
  const latest = await db.supportMessage.findFirst({
    where: { chatId: userId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { fromStaff: true },
  });
  await db.supportChat.update({ where: { userId }, data: { lastFromStaff: latest?.fromStaff ?? true } }).catch(() => {});
  return true;
}

/** A picture, for someone allowed to see it: the chat's user or an admin. */
export async function readImage(id: string, viewerId: string, admin: boolean) {
  const image = await db.supportImage.findUnique({ where: { id }, include: { message: { select: { chatId: true } } } });
  if (!image || (!admin && image.message.chatId !== viewerId)) return null;
  return image;
}

/** Only the first unread message of a run sends an email, and only to someone not looking at the chat right now. */
function shouldEmail(chat: SupportChat, from: Side, now: Date) {
  const unread = from === "user" ? chat.staffUnread : chat.userUnread;
  const readAt = from === "user" ? chat.staffReadAt : chat.userReadAt;
  return unread === 1 && (!readAt || now.getTime() - readAt.getTime() > READING_MS);
}

async function notify(userId: string, from: Side, body: string, picture: boolean) {
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
    const lines = picture ? [...preview, all.support.photo] : preview;
    const url = from === "user" ? `${app}/admin/support/${userId}` : `${app}/dashboard/support`;
    const mail = buttonMail({
      to: to.email,
      subject: format(t.subject, vars),
      paragraphs: [format(t.intro, vars), ...lines],
      button: t.button,
      url,
      footer: format(all.planMail.footer, { brand: BRAND_NAME, contact: `${app}/kontakt` }),
    });
    await sendPush([to.id], { title: mail.subject, body: lines.join(" ").slice(0, 160), url });
    try {
      await sendMail(mail);
    } catch (err) {
      console.error(`[mail] support chat email to ${from === "user" ? "admin" : "user"} for chat ${userId} failed:`, err);
    }
  }
}

/** When the newest message in any chat was sent, so the admin pages can tell something new came in. */
export async function latestMessageAt() {
  const { _max } = await db.supportChat.aggregate({ _max: { lastMessageAt: true } });
  return _max.lastMessageAt?.toISOString() ?? null;
}

/** The badge in the top bar: unread replies for a user, or the number of chats waiting for an admin. */
export async function unreadCount(userId: string, admin: boolean) {
  if (admin) return db.supportChat.count({ where: { staffUnread: { gt: 0 } } });
  const chat = await db.supportChat.findUnique({ where: { userId }, select: { userUnread: true } });
  return chat?.userUnread ?? 0;
}
