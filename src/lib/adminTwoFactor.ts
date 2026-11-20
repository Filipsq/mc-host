import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { auth } from "@/auth";

// An admin's powers (the admin panel, every server's panel, the chats) need a
// code from their authenticator app as well as the password, once per sign-in.
// Passing it leaves a signed cookie tied to that sign-in, good for a few hours.

export const TWO_FACTOR_COOKIE = "mch_admin2fa";
export const TWO_FACTOR_HOURS = 12;

const sign = (userId: string, signedInAt: number, expires: number) =>
  createHmac("sha256", process.env.AUTH_SECRET ?? "")
    .update(`admin2fa:${userId}:${signedInAt}:${expires}`)
    .digest("base64url");

/** Whether this request's admin entered a code since signing in (and within the last few hours). */
export async function passedTwoFactor(userId: string): Promise<boolean> {
  if (!process.env.AUTH_SECRET) return false;
  try {
    const [session, jar] = await Promise.all([auth(), cookies()]);
    if (session?.user?.id !== userId) return false;
    const [expires, given] = (jar.get(TWO_FACTOR_COOKIE)?.value ?? "").split(".");
    if (!(Number(expires) > Date.now()) || !given) return false;
    const expected = Buffer.from(sign(userId, session.signedInAt ?? 0, Number(expires)));
    const got = Buffer.from(given);
    return got.length === expected.length && timingSafeEqual(got, expected);
  } catch {
    // Outside a request (no cookies): never an admin.
    return false;
  }
}

/** Remembers, for this sign-in, that the admin entered a right code. */
export async function rememberTwoFactor(userId: string) {
  const session = await auth();
  const expires = Date.now() + TWO_FACTOR_HOURS * 60 * 60 * 1000;
  (await cookies()).set(TWO_FACTOR_COOKIE, `${expires}.${sign(userId, session?.signedInAt ?? 0, expires)}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TWO_FACTOR_HOURS * 60 * 60,
  });
}
