import "server-only";
import { randomInt } from "node:crypto";
import type { Server } from "@prisma/client";
import { db } from "./db";

// The renewal code: 3 days before a paid server's period ends, the reminder
// (planMail "reminder") brings a one-off code for RENEW_CODE_DISCOUNT percent
// off extending that server, valid RENEW_CODE_DAYS from sending (so also for a
// few days after the server stops). One per period, for that server only, used
// once. The discount covers at most 30 days: a longer period gets the same
// amount off as a month would. Not combined with other codes or offers.

export const RENEW_CODE_DISCOUNT = 20; // percent
export const RENEW_CODE_DAYS = 7;
const DAY = 24 * 60 * 60 * 1000;
// No 0/O, 1/I/L: the code is read off an email and typed in.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const newCode = () => "ODNOW-" + Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

/** The code as typed: case and spaces don't matter. */
export const normalizeRenewCode = (code: string) => code.toUpperCase().replace(/\s+/g, "");

type CodeFields = Pick<Server, "renewCode" | "renewCodeUntil" | "renewCodeUsedAt">;

/** The server's code, if it can still be used now. */
export function activeRenewCode(server: CodeFields, now = new Date()): { code: string; until: Date } | null {
  if (!server.renewCode || !server.renewCodeUntil || server.renewCodeUsedAt || server.renewCodeUntil <= now) return null;
  return { code: server.renewCode, until: server.renewCodeUntil };
}

/** Whether `typed` is this server's usable code. */
export const isRenewCodeFor = (server: CodeFields, typed: string, now = new Date()) => {
  const active = activeRenewCode(server, now);
  return !!active && normalizeRenewCode(typed) === active.code;
};

/** Gives the server a fresh code for its new period (called with the reminder). */
export async function issueRenewCode(serverId: string, now = new Date()): Promise<{ code: string; until: Date }> {
  const until = new Date(now.getTime() + RENEW_CODE_DAYS * DAY);
  for (let i = 0; ; i++) {
    const code = newCode();
    try {
      await db.server.update({ where: { id: serverId }, data: { renewCode: code, renewCodeUntil: until, renewCodeUsedAt: null } });
      return { code, until };
    } catch (err) {
      // Taken by another server (unique): try another one.
      if (i >= 4) throw err;
    }
  }
}

/** The discount in minor units: a fifth of the price, but of at most a month of it. */
export const renewCodeDiscount = (fullMinor: number, monthMinor: number) => Math.round((Math.min(fullMinor, monthMinor) * RENEW_CODE_DISCOUNT) / 100);
