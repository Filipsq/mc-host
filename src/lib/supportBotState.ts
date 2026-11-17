import "server-only";
import { db } from "./db";

// Whether the support bot (src/lib/supportBot.ts) answers in the Help chat. Kept
// apart from the bot itself so src/lib/support.ts can ask without importing it.

/** How long the bot stays quiet in a chat an admin answered, it handed over, or the user asked a person in. */
export const BOT_PAUSE_MS = 24 * 60 * 60_000;

/** OpenBot's webhook address and signing secret are in deploy/.env. */
export const botConfigured = () => !!process.env.OPENBOT_WEBHOOK_URL && !!process.env.OPENBOT_WEBHOOK_SECRET;

/** The admin panel's switch. */
export async function botEnabled() {
  const row = await db.supportBot.findUnique({ where: { id: 1 } });
  return row?.enabled ?? false;
}

export async function setBotEnabled(enabled: boolean) {
  await db.supportBot.upsert({ where: { id: 1 }, create: { id: 1, enabled }, update: { enabled } });
}

/** The bot answers: it's set up and switched on. */
export async function botActive() {
  return botConfigured() && (await botEnabled());
}
