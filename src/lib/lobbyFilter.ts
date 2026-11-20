import { censor, hasProfanity } from "./profanity";

// What the players' chat lets through (src/lib/lobby.ts). Most players are
// young, so nobody may post contact details or links away from the site:
// emails, phone numbers, IP addresses and links to other sites are refused,
// and swear words are masked the way the home page's opinions are.

export const LOBBY_MAX_LENGTH = 500;
export const NAME_MIN = 3;
export const NAME_MAX = 16;

/** Why a message or nickname was refused; the chat explains each one. */
export type LobbyTextError = "empty" | "tooLong" | "link" | "contact";
export type NameError = "nameFormat" | "nameBad" | "nameReserved";

// Endings of addresses people actually type. Words like "np." or "itp." aren't
// followed by one of these, so ordinary sentences pass.
const TLDS =
  "pl|com|net|org|gg|io|me|eu|xyz|de|uk|ru|info|tv|ly|link|app|dev|co|online|site|store|shop|club|top|fun|biz|cc|to|us|fr|cz|sk|ua|nl|be|es|it|host|space|website|live|pro|gl|su";
const DOMAIN = new RegExp(`(?:[a-z0-9-]+\\.)+(?:${TLDS})\\b`, "gi");
const SCHEME = /\b(?:https?:\/\/|www\.)\S+/gi;
const EMAIL = /[\p{L}\p{N}._%+-]+\s?(?:@|\(at\)|\[at\])\s?[\p{L}\p{N}-]+\.[a-z]{2,}/iu;
// Nine or more digits in a row, with spaces, dashes or dots between them allowed: a Polish phone number.
const PHONE = /(?:\+?\d[\s.-]?){9,}/;
const IPV4 = /\b\d{1,3}(?:\s?\.\s?\d{1,3}){3}\b/;
const OWN_SITE = /(?:^|\.)mchosting\.pl$/i;

/** The host part of something that looks like an address: "https://Www.MCHosting.pl/x" -> "www.mchosting.pl". */
function hostOf(match: string) {
  return match
    .replace(/^https?:\/\//i, "")
    .replace(/\s/g, "")
    .split(/[/?#:]/)[0]
    .toLowerCase();
}

/** Whether the text has a link anywhere but this site. */
export function hasForeignLink(text: string) {
  const found = [...(text.match(SCHEME) ?? []), ...(text.match(DOMAIN) ?? [])];
  return found.some((m) => !OWN_SITE.test(hostOf(m)));
}

/** Whether the text has an email, a phone number or an IP address in it. */
export function hasContact(text: string) {
  return EMAIL.test(text) || PHONE.test(text) || IPV4.test(text);
}

/**
 * The message as it's kept and shown (trimmed, at most two empty lines in a
 * row, swear words masked), or why it can't be sent.
 */
export function cleanMessage(raw: string, allowEmpty = false): { ok: true; text: string } | { ok: false; error: LobbyTextError } {
  const text = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[​-‍﻿]/g, "") // invisible characters that would hide a link
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text && !allowEmpty) return { ok: false, error: "empty" };
  if (text.length > LOBBY_MAX_LENGTH) return { ok: false, error: "tooLong" };
  if (hasContact(text)) return { ok: false, error: "contact" };
  if (hasForeignLink(text)) return { ok: false, error: "link" };
  return { ok: true, text: censor(text) };
}

// Parts of a nickname that would pass for the site's staff.
const RESERVED = ["admin", "adm1n", "moder", "mchost", "support", "pomoc", "obsluga", "fiq", "system", "official", "oficjal", "wlasciciel", "owner", "staff"];

/** Whether the nickname can be used; admins may use the reserved words. */
export function checkName(raw: string, admin = false): { ok: true; name: string } | { ok: false; error: NameError } {
  const name = raw.trim();
  if (!new RegExp(`^[A-Za-z0-9_]{${NAME_MIN},${NAME_MAX}}$`).test(name)) return { ok: false, error: "nameFormat" };
  if (hasProfanity(name) || hasProfanity(name.replace(/_/g, " "))) return { ok: false, error: "nameBad" };
  const plain = name.toLowerCase().replace(/_/g, "");
  if (!admin && RESERVED.some((r) => plain.includes(r))) return { ok: false, error: "nameReserved" };
  return { ok: true, name };
}
