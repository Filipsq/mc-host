import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { db } from "./db";
import { BRAND_NAME } from "./brand";
import { chatContextText } from "./claudeContext";
import { SUPPORT_KNOWLEDGE } from "./supportKnowledge";
import { screenPicture, SUPPORT_SCREENS, takeScreenMarker } from "./supportScreens";
import { IMAGE_MAX_BYTES, imageType, MAX_LENGTH, notify } from "./support";
import { botActive, BOT_PAUSE_MS } from "./supportBotState";

// The support bot (Fiq asked 2026-11-17): OpenBot answers simple questions in the
// Help chat and hands the rest to the admins.
//
// 1. A user writes; postMessage (support.ts) skips the admins' email and calls askBot.
// 2. askBot POSTs the question, the user's servers and the chat to OpenBot's webhook
//    (OPENBOT_WEBHOOK_URL), signed the way OpenBot checks it: HMAC-SHA256 with
//    OPENBOT_WEBHOOK_SECRET over "<unix seconds>.<delivery id>.<body>", sent as
//    x-openbot-timestamp / x-openbot-delivery-id / x-openbot-signature: sha256=<hex>.
// 3. The OpenBot routine answers by POSTing { token, text, escalate, screenshot? } to
//    /api/support/bot (handleBotReply). The token comes with the question, so no
//    other key is needed. The answer shows in the chat as the bot's message.
// 4. If the bot hands over (escalate), the webhook fails, or no answer comes within
//    ANSWER_WAIT_MS, the admins get the usual email and the bot stays quiet in that
//    chat for a day. An admin's own answer quiets it for a day too.

/** How long the user waits for the bot before the question goes to the admins. */
export const ANSWER_WAIT_MS = 2 * 60_000;
/** A reply token is accepted this long after the question. */
const TOKEN_MS = 15 * 60_000;
/** OpenBot refuses webhook bodies over 64 KB; this leaves room for the rest. */
const CONTEXT_MAX_BYTES = 40 * 1024;
const BOT_TIMEOUT_MS = 15_000;
/** The longest the question waits for the servers' live state before going to the bot without it. */
const CONTEXT_WAIT_MS = 4000;
/** Asking for a person this soon after the bot's answer means the answer didn't solve it. */
const PERSON_AFTER_MS = 2 * 60 * 60_000;
/** How the bot should write (Fiq asked 2026-11-18: casually). Sent with every question. */
const STYLE =
  "Pisz na luzie, po koleżeńsku, jak gracz do gracza: na Ty, krótko (2-5 zdań), bez urzędowych formułek, emoji z umiarem. " +
  "Gdy klient pyta, gdzie coś jest w panelu, dołącz gotowy zrzut z listy screenshots: wpisz jego key w pole screenshot. Nie rób własnych zrzutów.";

const secret = () => process.env.OPENBOT_WEBHOOK_SECRET ?? "";
const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";

const hmac = (key: string, data: string) => createHmac("sha256", key).update(data).digest();

/** A token for answering one chat until `expires` (unix ms): "<userId>.<expires>.<signature>". */
export function replyToken(userId: string, expires: number) {
  const payload = `${userId}.${expires}`;
  return `${payload}.${hmac(secret(), `reply:${payload}`).toString("base64url")}`;
}

/** The chat a reply token answers and when its question was sent, or null if it's forged or expired. */
export function checkReplyToken(token: string, now = Date.now()): { userId: string; askedAt: Date } | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !secret()) return null;
  const [userId, expires, signature] = parts;
  const expected = hmac(secret(), `reply:${userId}.${expires}`);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (!(Number(expires) > now)) return null;
  return { userId, askedAt: new Date(Number(expires) - TOKEN_MS) };
}

/** The OpenBot webhook headers for this body. */
export function signWebhook(body: string, deliveryId: string, now = Date.now()) {
  const timestamp = String(Math.floor(now / 1000));
  const signature = createHmac("sha256", secret()).update(`${timestamp}.${deliveryId}.`).update(body).digest("hex");
  return {
    "content-type": "application/json",
    "x-openbot-timestamp": timestamp,
    "x-openbot-delivery-id": deliveryId,
    "x-openbot-signature": `sha256=${signature}`,
  };
}

/** Cuts text to at most `max` UTF-8 bytes, keeping its end (the newest chat lines). */
function lastBytes(text: string, max: number) {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= max) return text;
  return `…${bytes.subarray(bytes.length - max).toString("utf8").replace(/^�+/, "")}`;
}

/** Sends the user's newest message to OpenBot. Called after the message was saved. */
export async function askBot(userId: string, messageId: string) {
  if (!(await botActive())) return;
  const message = await db.supportMessage.findUnique({
    where: { id: messageId },
    select: { body: true, log: true, image: { select: { id: true } }, chat: { select: { user: { select: { locale: true, email: true } } } } },
  });
  if (!message) return;
  const now = Date.now();
  await db.supportChat.update({ where: { userId }, data: { botWaitingSince: new Date(now) } });
  const question = message.body || (message.image ? "[zdjęcie]" : message.log ? "[konsola serwera]" : "");
  await db.supportBotCase.create({ data: { userId, question, askedAt: new Date(now) } }).catch(() => {});
  // The bot doesn't need the customer's email address, so it doesn't get it.
  // Reading live server state can be slow on a busy machine; the bot gets what's there after CONTEXT_WAIT_MS.
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), CONTEXT_WAIT_MS));
  const full = ((await Promise.race([chatContextText(userId).catch(() => null), timeout])) ?? "").split(message.chat.user.email).join("(adres ukryty)");
  const context = lastBytes(full, CONTEXT_MAX_BYTES);
  const body = JSON.stringify({
    type: "support.message",
    occurredAt: new Date(now).toISOString(),
    data: {
      site: BRAND_NAME,
      style: STYLE,
      knowledge: SUPPORT_KNOWLEDGE,
      screenshots: SUPPORT_SCREENS,
      language: message.chat.user.locale,
      customerMessage: message.body || "",
      sentPicture: !!message.image,
      sentConsole: !!message.log,
      context,
      reply: {
        url: `${appUrl()}/api/support/bot`,
        method: "POST",
        token: replyToken(userId, now + TOKEN_MS),
        body: '{"token": "<token>", "text": "<answer for the customer>", "escalate": false, "screenshot": "<optional key from screenshots>"}',
        maxLength: MAX_LENGTH,
        imageMaxBytes: IMAGE_MAX_BYTES,
      },
    },
  });
  try {
    const res = await fetch(process.env.OPENBOT_WEBHOOK_URL!, {
      method: "POST",
      headers: signWebhook(body, `mch-${messageId}-${randomUUID().slice(0, 8)}`, now),
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(BOT_TIMEOUT_MS),
    });
    await res.body?.cancel();
    if (res.status < 200 || res.status >= 300) throw new Error(`OpenBot webhook answered ${res.status}`);
    console.log(`[support-bot] chat ${userId}: question sent to OpenBot in ${((Date.now() - now) / 1000).toFixed(1)} s`);
  } catch (err) {
    console.error(`[support-bot] chat ${userId}: sending to OpenBot failed:`, err);
    await handOver(userId, null, "failed");
    return;
  }
  // The site runs as one long-lived process, so a timer is enough; the billing job
  // catches chats a restart left waiting (handOverLate).
  setTimeout(() => void handOverIfStillWaiting(userId, new Date(now)), ANSWER_WAIT_MS + 1000).unref?.();
}

async function handOverIfStillWaiting(userId: string, since: Date) {
  const chat = await db.supportChat.findUnique({ where: { userId }, select: { botWaitingSince: true } });
  if (chat?.botWaitingSince && chat.botWaitingSince <= since) await handOver(userId, null, "timeout");
}

/** For the billing job: chats whose bot answer is overdue go to the admins. */
export async function handOverLate(now = new Date()) {
  const late = await db.supportChat.findMany({
    where: { botWaitingSince: { lt: new Date(now.getTime() - ANSWER_WAIT_MS - 30_000) } },
    select: { userId: true },
  });
  for (const { userId } of late) await handOver(userId, null, "timeout");
  return late.length;
}

/** Adds the bot's message to the chat, which the user sees like an admin's (marked as the bot), with an optional picture. */
async function postBotMessage(userId: string, text: string, picture?: { data: Uint8Array; type: string }) {
  const now = new Date();
  await db.$transaction([
    db.supportChat.update({
      where: { userId },
      data: { lastMessageAt: now, lastFromStaff: true, staffUnread: 0, userUnread: { increment: 1 } },
    }),
    db.supportMessage.create({
      data: {
        chatId: userId,
        fromStaff: true,
        bot: true,
        body: text,
        createdAt: now,
        ...(picture ? { image: { create: { type: picture.type, size: picture.data.byteLength, data: picture.data } } } : {}),
      },
    }),
  ]);
}

const HANDOVER_TEXT: Record<string, Record<"failed" | "timeout" | "asked", string>> = {
  pl: {
    failed: "🤖 Przekazałem Twoje pytanie administratorowi. Odpowie tutaj, a dostaniesz też e-mail.",
    timeout: "🤖 Odpowiedź zajmuje mi dłużej, więc na wszelki wypadek przekazałem pytanie też administratorowi. Ktoś z nas odpowie tutaj, a dostaniesz też e-mail.",
    asked: "🤖 Jasne, przekazałem rozmowę administratorowi. Odpowie tutaj, a dostaniesz też e-mail.",
  },
  en: {
    failed: "🤖 I've passed your question to an admin. They'll answer here and you'll get an email too.",
    timeout: "🤖 This is taking me longer, so I've also passed your question to an admin. One of us will answer here and you'll get an email too.",
    asked: "🤖 Sure, I've passed the chat to an admin. They'll answer here and you'll get an email too.",
  },
};

/**
 * The admins take the chat over: the bot says so (or posts `text`, its own
 * words), the chat waits for an admin, they get the usual email, and the bot
 * stays quiet in it for a day.
 */
async function handOver(userId: string, text: string | null, why: "failed" | "timeout" | "asked" | "bot") {
  const chat = await db.supportChat.findUnique({ where: { userId }, include: { user: { select: { locale: true } } } });
  if (!chat) return;
  const now = new Date();
  // Someone else already handed over or answered.
  if (why !== "asked" && !chat.botWaitingSince) return;
  const note = text ?? HANDOVER_TEXT[chat.user.locale === "en" ? "en" : "pl"][why === "bot" ? "timeout" : why];
  await postBotMessage(userId, note);
  await db.supportChat.update({
    where: { userId },
    data: { botWaitingSince: null, botPausedUntil: new Date(now.getTime() + BOT_PAUSE_MS), lastFromStaff: false, staffUnread: { increment: 1 } },
  });
  // The report: questions still open end this way, and an answer the user didn't want counts as half solved.
  const result = { failed: "failed", timeout: "timeout", asked: "person", bot: "handedOver" }[why];
  await db.supportBotCase.updateMany({ where: { userId, result: null }, data: { result, ...(why === "bot" && text ? { answer: text, answeredAt: now } : {}) } });
  if (why === "asked") {
    // Only the bot's latest answer didn't do it.
    const last = await db.supportBotCase.findFirst({
      where: { userId, result: "answered", askedAt: { gte: new Date(now.getTime() - PERSON_AFTER_MS) } },
      orderBy: { askedAt: "desc" },
      select: { id: true },
    });
    if (last) await db.supportBotCase.update({ where: { id: last.id }, data: { personAfter: true } });
  }
  const question = await db.supportMessage.findFirst({
    where: { chatId: userId, fromStaff: false, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { body: true, image: { select: { id: true } } },
  });
  await notify(userId, "user", question?.body ?? "", !!question?.image, why);
}

/** The user asked for a person instead of the bot. */
export async function askForPerson(userId: string) {
  const chat = await db.supportChat.findUnique({ where: { userId }, select: { botPausedUntil: true } });
  if (!chat || (chat.botPausedUntil && chat.botPausedUntil > new Date())) return false;
  await handOver(userId, null, "asked");
  return true;
}

export type BotReplyResult =
  | { ok: true }
  | { ok: false; error: "badToken" | "empty" | "tooLong" | "notWaiting" | "imageType" | "imageTooBig"; status: number };

/** A picture the bot sent as base64 (a data: URL works too), checked like a customer's. */
function botPicture(image: string): { data: Uint8Array; type: string } | "imageType" | "imageTooBig" {
  const base64 = image.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  if (base64.length > Math.ceil((IMAGE_MAX_BYTES * 4) / 3) + 4) return "imageTooBig";
  const data = new Uint8Array(Buffer.from(base64, "base64"));
  if (data.byteLength > IMAGE_MAX_BYTES) return "imageTooBig";
  const type = imageType(data);
  return type ? { data, type } : "imageType";
}

/** OpenBot's answer to a question askBot sent. */
export async function handleBotReply(
  token: string,
  text: string,
  escalate: boolean,
  image?: string,
  screenshot?: string,
): Promise<BotReplyResult> {
  const checked = checkReplyToken(token);
  if (!checked) return { ok: false, error: "badToken", status: 401 };
  const { userId, askedAt } = checked;
  console.log(`[support-bot] chat ${userId}: OpenBot answered after ${((Date.now() - askedAt.getTime()) / 1000).toFixed(1)} s${escalate ? " (handed over)" : ""}`);
  // A ready screenshot named in the "screenshot" field or as [zrzut:key] in the text.
  const marked = takeScreenMarker(text.replace(/\r\n?/g, "\n"));
  const body = marked.text;
  const screenKey = screenshot || marked.key;
  if (body.length > MAX_LENGTH) return { ok: false, error: "tooLong", status: 400 };
  const chat = await db.supportChat.findUnique({ where: { userId }, select: { botWaitingSince: true } });
  // Over ANSWER_WAIT_MS the question went to the admins, but an answer that comes
  // while the token is valid and no admin has answered still helps (Fiq 2026-11-25:
  // OpenBot knew the answer and got 409).
  const late = !chat?.botWaitingSince && (await lateAnswerWelcome(userId, askedAt));
  // Answered already, an admin answered first, or the user asked for a person.
  if (!chat?.botWaitingSince && !late) return { ok: false, error: "notWaiting", status: 409 };
  // Already with the admins: a late hand-over changes nothing.
  if (late && escalate) return { ok: true };
  if (escalate) {
    await handOver(userId, body ? body : null, "bot");
    return { ok: true };
  }
  let picture = image ? botPicture(image) : undefined;
  if (typeof picture === "string") return { ok: false, error: picture, status: 400 };
  if (!picture && screenKey) {
    picture = (await screenPicture(screenKey)) ?? undefined;
    if (!picture) console.log(`[support-bot] unknown screenshot "${screenKey}", sent without it`);
  }
  if (!body && !picture) return { ok: false, error: "empty", status: 400 };
  await postBotMessage(userId, body, picture);
  if (late) {
    // The bot works after all: it isn't quiet for the day the timeout set.
    await db.supportChat.update({ where: { userId }, data: { botPausedUntil: null } });
    console.log(`[support-bot] chat ${userId}: late answer accepted`);
  }
  await db.supportBotCase
    .updateMany({ where: { userId, askedAt, result: late ? "timeout" : null }, data: { result: "answered", answer: body || "[zdjęcie]", answeredAt: new Date() } })
    .catch(() => {});
  // A question the user sent after this one still waits for its own answer.
  await db.supportChat.updateMany({ where: { userId, botWaitingSince: { lte: askedAt } }, data: { botWaitingSince: null } });
  after(() => notifyUserIfAway(userId, body));
  return { ok: true };
}

/**
 * Whether a bot answer that came after the wait may still go to the chat: the
 * question timed out (not handed over by the bot or at the user's wish) and no
 * admin has written since it was asked.
 */
async function lateAnswerWelcome(userId: string, askedAt: Date) {
  const [timedOut, admin] = await Promise.all([
    db.supportBotCase.findFirst({ where: { userId, askedAt, result: "timeout" }, select: { id: true } }),
    db.supportMessage.findFirst({ where: { chatId: userId, fromStaff: true, bot: false, deletedAt: null, createdAt: { gt: askedAt } }, select: { id: true } }),
  ]);
  return !!timedOut && !admin;
}

/** Like an admin's answer: the user gets an email if they aren't looking at the chat. */
async function notifyUserIfAway(userId: string, body: string) {
  const chat = await db.supportChat.findUnique({ where: { userId }, select: { userReadAt: true, userUnread: true } });
  if (!chat || chat.userUnread !== 1) return;
  if (chat.userReadAt && Date.now() - chat.userReadAt.getTime() < 60_000) return;
  await notify(userId, "staff", body, false);
}
