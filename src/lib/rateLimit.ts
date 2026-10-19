import "server-only";

// Counts attempts in memory, per key, over a sliding window. The site runs as
// one process, so this is enough to stop someone guessing passwords or making
// accounts in bulk; a restart only forgets the counts.

const hits = new Map<string, number[]>();
let lastSweep = 0;

function recent(key: string, windowMs: number, now: number) {
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length) hits.set(key, list);
  else hits.delete(key);
  return list;
}

/** Drops keys nobody used for a day, so the map can't grow without end. */
function sweep(now: number) {
  if (now - lastSweep < 10 * 60_000) return;
  lastSweep = now;
  for (const [key, list] of hits) if (!list.length || now - list[list.length - 1] > 24 * 60 * 60_000) hits.delete(key);
}

/** Whether the key already had `max` attempts in the window. */
export function isLimited(key: string, max: number, windowMs: number) {
  return recent(key, windowMs, Date.now()).length >= max;
}

/** Counts one attempt for the key. */
export function hit(key: string) {
  const now = Date.now();
  sweep(now);
  const list = hits.get(key) ?? [];
  list.push(now);
  hits.set(key, list);
}

/** Forgets the key's attempts, e.g. after the right password. */
export function clearHits(key: string) {
  hits.delete(key);
}

/** The visitor's address as Caddy passes it on (Caddy replaces whatever the browser sent). */
export function clientIp(headers: Headers) {
  return headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
}

const MINUTE = 60_000;

// Wrong passwords: per account, so one can't be guessed at, and per address,
// so one visitor can't try a password on many accounts.
export const LOGIN_PER_EMAIL = { max: 10, windowMs: 15 * MINUTE };
export const LOGIN_PER_IP = { max: 30, windowMs: 15 * MINUTE };
/** New accounts from one address (a family or school may share one). */
export const SIGNUPS_PER_IP = { max: 5, windowMs: 60 * MINUTE };
/** Password reset requests from one address, so the email quota can't be used up. */
export const RESETS_PER_IP = { max: 10, windowMs: 60 * MINUTE };

export const loginKeys = (email: string, ip: string) => ({ email: `login:email:${email}`, ip: `login:ip:${ip}` });

/** Whether this sign-in has to wait because of too many wrong passwords. */
export function loginLimited(email: string, ip: string) {
  const k = loginKeys(email, ip);
  return isLimited(k.email, LOGIN_PER_EMAIL.max, LOGIN_PER_EMAIL.windowMs) || isLimited(k.ip, LOGIN_PER_IP.max, LOGIN_PER_IP.windowMs);
}
