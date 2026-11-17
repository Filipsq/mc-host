import "server-only";
import { db } from "./db";
import { adminOnline } from "./presence";

// When the support bot (src/lib/supportBot.ts) answers in the Help chat. Kept
// apart from the bot itself so src/lib/support.ts can ask without importing it.

/** How long the bot stays quiet in a chat an admin answered, it handed over, or the user asked a person in. */
export const BOT_PAUSE_MS = 24 * 60 * 60_000;

/** OpenBot's webhook address and signing secret are in deploy/.env. */
export const botConfigured = () => !!process.env.OPENBOT_WEBHOOK_URL && !!process.env.OPENBOT_WEBHOOK_SECRET;

export type BotSwitches = { whenOnline: boolean; whenOffline: boolean };

/**
 * The admin panel's two switches (Fiq asked 2026-11-18): whether the bot answers
 * while an admin is on the site (off by default, the admin answers), and while
 * none is (on by default).
 */
export async function botSwitches(): Promise<BotSwitches> {
  const row = await db.supportBot.findUnique({ where: { id: 1 } });
  return { whenOnline: row?.whenOnline ?? false, whenOffline: row?.whenOffline ?? true };
}

export async function setBotSwitch(which: keyof BotSwitches, on: boolean) {
  await db.supportBot.upsert({ where: { id: 1 }, create: { id: 1, [which]: on }, update: { [which]: on } });
}

/** The bot answers right now: it's set up and switched on for whether an admin is on the site. */
export async function botActive() {
  if (!botConfigured()) return false;
  const s = await botSwitches();
  return adminOnline() ? s.whenOnline : s.whenOffline;
}
