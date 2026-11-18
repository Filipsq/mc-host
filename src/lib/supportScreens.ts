import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import screens from "./supportScreens.json";

// Ready screenshots of a test account's panel the support bot can send when a
// customer asks where something is (Fiq asked 2026-11-18). Made by
// scripts/support-screenshots.mjs, never from a customer's or an admin's account.
// The bot names one by key ("screenshot" field, or [zrzut:key] in its text).

/** What the bot is told about each screenshot. */
export const SUPPORT_SCREENS = screens.map(({ key, title, when }) => ({ key, title, when }));

const KEYS = new Set(screens.map((s) => s.key));
const MARKER = /\[\s*zrzut\s*:\s*([a-z0-9-]+)\s*\]/gi;

/** The text without [zrzut:key] markers, and the first known key it named. */
export function takeScreenMarker(text: string): { text: string; key?: string } {
  let key: string | undefined;
  const rest = text.replace(MARKER, (_, k: string) => {
    if (!key && KEYS.has(k.toLowerCase())) key = k.toLowerCase();
    return "";
  });
  return { text: rest.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(), key };
}

/** The screenshot for a key as a chat picture, or null for an unknown key or a missing file. */
export async function screenPicture(key: string): Promise<{ data: Uint8Array; type: string } | null> {
  const k = key.trim().toLowerCase();
  if (!KEYS.has(k)) return null;
  try {
    const data = await readFile(join(process.cwd(), "public", "pomoc", `${k}.png`));
    return { data: new Uint8Array(data), type: "image/png" };
  } catch {
    return null;
  }
}
