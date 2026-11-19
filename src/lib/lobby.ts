import "server-only";
import { after } from "next/server";
import { db } from "./db";
import { messages, format } from "@/i18n/messages";
import { defaultLocale, isLocale } from "@/i18n/config";
import { BRAND_NAME } from "./brand";
import { buttonMail, sendMail } from "./mail";
import { sendPush } from "./push";
import { hit, isLimited } from "./rateLimit";
import { addressLabel } from "./servers";
import { timeFormat } from "./support";
import { censor } from "./profanity";
import { checkName, cleanMessage, type LobbyTextError, type NameError } from "./lobbyFilter";

// The players' chat ("Czat graczy"): one room next to the help chat where
// every signed-in user can talk, recommend their servers and swap tips about
// mods. Players show by a nickname they pick, never by email. Most of them are
// young and there's one admin, so it guards itself: contact details and
// outside links are refused (lobbyFilter.ts), there's a rate limit, anyone can
// report a message, a message reported by LOBBY_HIDE_REPORTS people hides
// until an admin looks, and an admin can delete messages, mute people and
// switch the whole chat off. Open chats poll /api/lobby.

/** How many of the latest messages the chat shows. */
export const LOBBY_SHOWN = 80;
/** Messages older than this are deleted for good (the privacy policy says so). */
export const LOBBY_KEEP_DAYS = 90;
/** Reports from this many different people hide a message until an admin decides. */
export const LOBBY_HIDE_REPORTS = 3;
/** Per user: at most `count` messages a minute, and `gapMs` between two. */
export const LOBBY_RATE = { count: 5, windowMs: 60_000, gapMs: 3000 };
/** Shared servers per user, so the chat doesn't turn into adverts. */
export const SHARE_RATE = { count: 3, windowMs: 10 * 60_000 };
/** Reports per user, so nobody can bury the admin in them. */
const REPORT_RATE = { count: 10, windowMs: 60 * 60_000 };
/** Someone who polled this recently counts as in the chat. */
const ONLINE_MS = 60_000;
/** A mute "for good". */
export const FOREVER = new Date("9999-12-31T00:00:00Z");
/** Report reasons people pick from. */
export const REPORT_REASONS = ["rude", "spam", "personal", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export type LobbyMessage = {
  id: string;
  author: string;
  /** Written by an admin. */
  admin?: true;
  /** Written by the viewer. */
  own?: true;
  /** The author's account, only for admins (to mute them). */
  uid?: string;
  body: string;
  /** ISO time, for ordering and polling. */
  at: string;
  /** The time as people read it, in Polish time. */
  time: string;
  /** A server its owner shared. */
  server?: { name: string; address: string };
};

export type LobbyMe = {
  /** The viewer's nickname, or null until they pick one. */
  name: string | null;
  /** Until when the viewer is muted, as people read it, or "forever". */
  muted: string | null;
  admin: boolean;
};

export type LobbyState = {
  on: boolean;
  messages: LobbyMessage[];
  /** Messages removed since the poll's `since`, which open chats drop. */
  deleted?: string[];
  me: LobbyMe;
  /** How many people have the chat open. */
  online: number;
  /** The viewer's own servers, for "Wklej mój serwer" (only on the first load). */
  servers?: { id: string; name: string; address: string }[];
};

export type LobbyError = LobbyTextError | NameError | "off" | "muted" | "noName" | "tooFast" | "tooMany" | "repeat" | "shareTooMany" | "server" | "nameTaken" | "signedOut";

// Kept in memory, like the admin's presence (src/lib/presence.ts): the site runs as one process.
const store = globalThis as unknown as {
  lobbySeen?: Map<string, number>;
  lobbySweptAt?: number;
  lobbyMailedAt?: number;
  lobbySwitch?: { on: boolean; at: number };
};
const seen = (store.lobbySeen ??= new Map());

function markSeen(userId: string) {
  const now = Date.now();
  seen.set(userId, now);
  for (const [id, at] of seen) if (now - at > ONLINE_MS) seen.delete(id);
}

/** Deletes messages past LOBBY_KEEP_DAYS, at most once an hour (their reports go with them). */
function sweepOld() {
  const now = Date.now();
  if (store.lobbySweptAt && now - store.lobbySweptAt < 60 * 60_000) return;
  store.lobbySweptAt = now;
  after(() =>
    db.lobbyMessage
      .deleteMany({ where: { createdAt: { lt: new Date(now - LOBBY_KEEP_DAYS * 24 * 60 * 60_000) } } })
      .catch((err) => console.error("lobby: sweeping old messages failed", err)),
  );
}

/**
 * Whether the players' chat is on. Every page asks (for the help bubble's
 * tab), so the answer is kept for 30 seconds. Never breaks a page: on a
 * database error it counts as off.
 */
export async function lobbyOn() {
  const cached = store.lobbySwitch;
  if (cached && Date.now() - cached.at < 30_000) return cached.on;
  try {
    const on = (await db.lobbySwitch.findUnique({ where: { id: 1 } }))?.enabled ?? true;
    store.lobbySwitch = { on, at: Date.now() };
    return on;
  } catch (err) {
    console.error("lobby: reading the switch failed", err);
    return false;
  }
}

export async function setLobbyOn(enabled: boolean) {
  await db.lobbySwitch.upsert({ where: { id: 1 }, create: { id: 1, enabled }, update: { enabled } });
  store.lobbySwitch = { on: enabled, at: Date.now() };
}

type Row = {
  id: string;
  userId: string;
  fromAdmin: boolean;
  body: string;
  serverName: string | null;
  serverAddress: string | null;
  createdAt: Date;
  user: { chatName: string | null };
};

function toMessage(row: Row, viewerId: string, admin: boolean, time: (d: Date) => string): LobbyMessage {
  return {
    id: row.id,
    author: row.user.chatName ?? "?",
    ...(row.fromAdmin ? { admin: true as const } : {}),
    ...(row.userId === viewerId ? { own: true as const } : {}),
    ...(admin ? { uid: row.userId } : {}),
    body: row.body,
    at: row.createdAt.toISOString(),
    time: time(row.createdAt),
    ...(row.serverName && row.serverAddress ? { server: { name: row.serverName, address: row.serverAddress } } : {}),
  };
}

const ROW = {
  id: true,
  userId: true,
  fromAdmin: true,
  body: true,
  serverName: true,
  serverAddress: true,
  createdAt: true,
  user: { select: { chatName: true } },
} as const;

function mutedLabel(until: Date | null, locale: string) {
  if (!until || until <= new Date()) return null;
  if (until >= FOREVER) return "forever";
  return timeFormat(locale)(until);
}

/** The chat as the viewer sees it: the latest messages (or those from `since` on). */
export async function readLobby(viewerId: string, admin: boolean, locale: string, since?: Date): Promise<LobbyState> {
  markSeen(viewerId);
  sweepOld();
  const [on, rows, gone, me, servers] = await Promise.all([
    lobbyOn(),
    db.lobbyMessage.findMany({
      where: { deletedAt: null, ...(since ? { createdAt: { gte: since } } : {}) },
      orderBy: { createdAt: "desc" },
      take: LOBBY_SHOWN,
      select: ROW,
    }),
    since ? db.lobbyMessage.findMany({ where: { deletedAt: { gte: since } }, select: { id: true } }) : [],
    db.user.findUnique({ where: { id: viewerId }, select: { chatName: true, chatMutedUntil: true } }),
    since ? null : db.server.findMany({ where: { ownerId: viewerId }, orderBy: { createdAt: "asc" }, take: 20 }),
  ]);
  const time = timeFormat(locale);
  return {
    on,
    messages: rows.reverse().map((r) => toMessage(r, viewerId, admin, time)),
    ...(since ? { deleted: gone.map((g) => g.id) } : {}),
    me: { name: me?.chatName ?? null, muted: mutedLabel(me?.chatMutedUntil ?? null, locale), admin },
    online: seen.size,
    ...(servers ? { servers: servers.map((s) => ({ id: s.id, name: censor(s.name), address: addressLabel(s) })) } : {}),
  };
}

/** Picks (or changes) the viewer's nickname. */
export async function setChatName(userId: string, admin: boolean, raw: string): Promise<{ ok: true; name: string } | { ok: false; error: LobbyError }> {
  const checked = checkName(String(raw), admin);
  if (!checked.ok) return checked;
  const key = checked.name.toLowerCase();
  const taken = await db.user.findFirst({ where: { chatNameKey: key, id: { not: userId } }, select: { id: true } });
  if (taken) return { ok: false, error: "nameTaken" };
  try {
    await db.user.update({ where: { id: userId }, data: { chatName: checked.name, chatNameKey: key } });
  } catch {
    return { ok: false, error: "nameTaken" }; // picked by someone else a moment ago
  }
  return { ok: true, name: checked.name };
}

export type PostResult = { ok: true; message: LobbyMessage } | { ok: false; error: LobbyError };

/** Posts a message to the players' chat, with one of the author's servers if they chose to share it. */
export async function postLobby(userId: string, admin: boolean, raw: string, locale: string, serverId?: string): Promise<PostResult> {
  const cleaned = cleanMessage(String(raw), !!serverId);
  if (!cleaned.ok) return cleaned;
  const [on, user] = await Promise.all([
    lobbyOn(),
    db.user.findUnique({ where: { id: userId }, select: { chatName: true, chatMutedUntil: true, deletedAt: true } }),
  ]);
  if (!user || user.deletedAt) return { ok: false, error: "signedOut" };
  if (!on && !admin) return { ok: false, error: "off" };
  if (!user.chatName) return { ok: false, error: "noName" };
  if (user.chatMutedUntil && user.chatMutedUntil > new Date()) return { ok: false, error: "muted" };

  let server: { name: string; address: string } | null = null;
  if (serverId) {
    const s = await db.server.findFirst({ where: { id: String(serverId), ownerId: userId } });
    if (!s) return { ok: false, error: "server" };
    server = { name: censor(s.name).slice(0, 60), address: addressLabel(s) };
  }

  if (!admin) {
    const gapKey = `lobby:gap:${userId}`;
    const minuteKey = `lobby:min:${userId}`;
    if (isLimited(gapKey, 1, LOBBY_RATE.gapMs)) return { ok: false, error: "tooFast" };
    if (isLimited(minuteKey, LOBBY_RATE.count, LOBBY_RATE.windowMs)) return { ok: false, error: "tooMany" };
    if (server && isLimited(`lobby:share:${userId}`, SHARE_RATE.count, SHARE_RATE.windowMs)) return { ok: false, error: "shareTooMany" };
    // The same text twice within a few minutes is spam.
    const last = await db.lobbyMessage.findFirst({
      where: { userId, createdAt: { gte: new Date(Date.now() - 5 * 60_000) } },
      orderBy: { createdAt: "desc" },
      select: { body: true, serverName: true },
    });
    if (last && cleaned.text && last.body.toLowerCase() === cleaned.text.toLowerCase() && !!last.serverName === !!server) {
      return { ok: false, error: "repeat" };
    }
    hit(gapKey);
    hit(minuteKey);
    if (server) hit(`lobby:share:${userId}`);
  }

  const row = await db.lobbyMessage.create({
    data: {
      userId,
      fromAdmin: admin,
      body: cleaned.text,
      ...(server && serverId ? { serverId, serverName: server.name, serverAddress: server.address } : {}),
    },
    select: ROW,
  });
  markSeen(userId);
  return { ok: true, message: toMessage(row, userId, admin, timeFormat(locale)) };
}

/** A user reports someone else's message. The admins hear about a message's first report. */
export async function reportLobby(userId: string, messageId: string, reason: string): Promise<{ ok: boolean; error?: "tooMany" | "notFound" }> {
  const why = (REPORT_REASONS as readonly string[]).includes(reason) ? reason : "other";
  const message = await db.lobbyMessage.findFirst({ where: { id: String(messageId), deletedAt: null }, select: { id: true, userId: true, body: true, user: { select: { chatName: true } } } });
  if (!message || message.userId === userId) return { ok: false, error: "notFound" };
  const key = `lobby:report:${userId}`;
  if (isLimited(key, REPORT_RATE.count, REPORT_RATE.windowMs)) return { ok: false, error: "tooMany" };
  hit(key);
  const created = await db.lobbyReport
    .create({ data: { messageId: message.id, reporterId: userId, reason: why } })
    .then(() => true)
    .catch(() => false); // reported it before: nothing more to do
  if (!created) return { ok: true };

  const open = await db.lobbyReport.count({ where: { messageId: message.id, resolvedAt: null } });
  if (open >= LOBBY_HIDE_REPORTS) {
    await db.lobbyMessage.updateMany({ where: { id: message.id, deletedAt: null }, data: { deletedAt: new Date(), hiddenByReports: true } });
  }
  if (open === 1 || open === LOBBY_HIDE_REPORTS) after(() => notifyAdmins(message.user.chatName ?? "?", message.body, why, open >= LOBBY_HIDE_REPORTS));
  return { ok: true };
}

/** Tells the admins about a report: a phone notification always, an email at most every 10 minutes. */
async function notifyAdmins(author: string, body: string, reason: string, hidden: boolean) {
  const admins = await db.user.findMany({ where: { admin: true }, select: { id: true, email: true, locale: true } });
  const app = process.env.APP_URL ?? "http://localhost:3000";
  const url = `${app}/admin/chat`;
  const mail = Date.now() - (store.lobbyMailedAt ?? 0) > 10 * 60_000;
  if (mail) store.lobbyMailedAt = Date.now();
  for (const to of admins) {
    const t = messages[isLocale(to.locale) ? to.locale : defaultLocale];
    const m = t.lobby.mail;
    const subject = format(hidden ? m.hiddenSubject : m.subject, { name: author });
    const preview = `${author}: ${body.slice(0, 300)}`;
    await sendPush([to.id], { title: subject, body: preview.slice(0, 160), url });
    if (!mail) continue;
    try {
      await sendMail(
        buttonMail({
          to: to.email,
          subject,
          paragraphs: [format(m.intro, { reason: t.lobby.reasons[reason as ReportReason] ?? reason }), preview],
          button: m.button,
          url,
          footer: format(t.planMail.footer, { brand: BRAND_NAME, contact: `${app}/kontakt` }),
        }),
      );
    } catch (err) {
      console.error("[mail] players' chat report email failed:", err);
    }
  }
}

// ---- Admin side ----

/** An admin deletes a message; its reports count as handled. */
export async function removeLobbyMessage(messageId: string) {
  const now = new Date();
  await db.$transaction([
    db.lobbyMessage.updateMany({ where: { id: messageId }, data: { deletedAt: now, body: "", serverName: null, serverAddress: null } }),
    db.lobbyReport.updateMany({ where: { messageId, resolvedAt: null }, data: { resolvedAt: now } }),
  ]);
}

/** An admin found nothing wrong: the reports are closed and a message hidden by them comes back. */
export async function keepLobbyMessage(messageId: string) {
  await db.$transaction([
    db.lobbyReport.updateMany({ where: { messageId, resolvedAt: null }, data: { resolvedAt: new Date() } }),
    db.lobbyMessage.updateMany({ where: { id: messageId, hiddenByReports: true }, data: { deletedAt: null, hiddenByReports: false } }),
  ]);
}

/** Mutes a user for `hours`, or for good with null. Admins can't be muted. */
export async function muteUser(userId: string, hours: number | null) {
  const until = hours === null ? FOREVER : new Date(Date.now() + hours * 60 * 60_000);
  await db.user.updateMany({ where: { id: userId, admin: false }, data: { chatMutedUntil: until } });
}

export async function unmuteUser(userId: string) {
  await db.user.updateMany({ where: { id: userId }, data: { chatMutedUntil: null } });
}

/** Takes a rude nickname away: the user has to pick another before writing again. */
export async function resetChatName(userId: string) {
  await db.user.updateMany({ where: { id: userId, admin: false }, data: { chatName: null, chatNameKey: null } });
}

/** Deletes everything a user wrote in the players' chat (an admin's "remove all", or their account going). */
export async function removeAllBy(userId: string) {
  const ids = (await db.lobbyMessage.findMany({ where: { userId, deletedAt: null }, select: { id: true } })).map((m) => m.id);
  const now = new Date();
  await db.$transaction([
    db.lobbyMessage.updateMany({ where: { id: { in: ids } }, data: { deletedAt: now, body: "", serverName: null, serverAddress: null } }),
    db.lobbyReport.updateMany({ where: { messageId: { in: ids }, resolvedAt: null }, data: { resolvedAt: now } }),
  ]);
  return ids.length;
}

/** Open reports, one entry per message with who reported it and why. */
export async function openReports(locale: string) {
  const rows = await db.lobbyMessage.findMany({
    where: { reports: { some: { resolvedAt: null } } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      ...ROW,
      hiddenByReports: true,
      user: { select: { chatName: true, email: true, chatMutedUntil: true } },
      reports: { where: { resolvedAt: null }, orderBy: { createdAt: "asc" }, select: { reason: true, createdAt: true, reporter: { select: { chatName: true } } } },
    },
  });
  const time = timeFormat(locale);
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    author: r.user.chatName ?? "?",
    email: r.user.email,
    muted: mutedLabel(r.user.chatMutedUntil, locale),
    body: r.body,
    server: r.serverName && r.serverAddress ? `${r.serverName} (${r.serverAddress})` : null,
    time: time(r.createdAt),
    hidden: r.hiddenByReports,
    reports: r.reports.map((p) => ({ reason: p.reason as ReportReason, by: p.reporter.chatName ?? "?", time: time(p.createdAt) })),
  }));
}

/** How many messages wait for an admin's look, for the admin tab's badge. */
export async function openReportCount() {
  try {
    return await db.lobbyMessage.count({ where: { reports: { some: { resolvedAt: null } } } });
  } catch {
    return 0;
  }
}

/** Users muted right now. */
export async function mutedUsers(locale: string) {
  const rows = await db.user.findMany({
    where: { chatMutedUntil: { gt: new Date() } },
    orderBy: { chatMutedUntil: "asc" },
    select: { id: true, email: true, chatName: true, chatMutedUntil: true },
  });
  return rows.map((u) => ({ id: u.id, email: u.email, name: u.chatName, until: mutedLabel(u.chatMutedUntil, locale) }));
}
