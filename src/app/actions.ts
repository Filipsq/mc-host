"use server";

import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AuthError } from "next-auth";
import { db } from "@/lib/db";
import { credentialsSchema } from "@/lib/credentials";
import { auth, signIn, signOut } from "@/auth";
import { CURRENCY_COOKIE, LOCALE_COOKIE, isCurrency, isLocale } from "@/i18n/config";
import { format, type Messages } from "@/i18n/messages";
import { getMessages, getPreferences } from "@/i18n/server";
import { BRAND_NAME } from "@/lib/brand";
import { buttonMail, sendMail } from "@/lib/mail";
import { RESET_LINK_MINUTES, changePassword, createResetToken, resetPassword } from "@/lib/passwordReset";
import { getSession } from "@/lib/session";
import { linkInvites } from "@/lib/access";
import { REFERRAL_COOKIE, inviterFor } from "@/lib/referrals";
import { PUSH_COOKIE } from "@/lib/pushEndpoint";
import { LOGIN_PER_EMAIL, RESETS_PER_IP, SIGNUPS_PER_IP, clientIp, hit, isLimited, loginLimited } from "@/lib/rateLimit";

export type AuthErrorCode = keyof Messages["auth"]["errors"];

// email is echoed back so the form keeps it after React resets inputs on submit.
export type FormState = { error?: AuthErrorCode; email?: string; sent?: boolean };

/** Where to land after signing in: the create page, asking the AI about a home page description, or the dashboard. */
function afterSignIn(form: FormData) {
  const opis = String(form.get("opis") ?? "").trim().slice(0, 500);
  return opis ? `/dashboard/new?opis=${encodeURIComponent(opis)}` : "/dashboard";
}

export async function signUp(_: FormState, form: FormData): Promise<FormState> {
  const parsed = credentialsSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const field = parsed.error.issues[0].path[0];
    return {
      error: field === "email" ? "invalidEmail" : "passwordTooShort",
      email: String(form.get("email") ?? ""),
    };
  }

  const { email, password } = parsed.data;
  if (form.get("terms") !== "on") return { error: "termsRequired", email };
  if (await db.user.findUnique({ where: { email } })) {
    return { error: "emailTaken", email };
  }
  const signupKey = `signup:ip:${clientIp(await headers())}`;
  if (isLimited(signupKey, SIGNUPS_PER_IP.max, SIGNUPS_PER_IP.windowMs)) return { error: "tooManyAttempts", email };
  hit(signupKey);
  const { locale } = await getPreferences();
  // Signed up through a friend's invite link (see src/lib/referrals.ts).
  const jar = await cookies();
  const inviter = await inviterFor(jar.get(REFERRAL_COOKIE)?.value);
  const user = await db.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(password, 12),
      termsAcceptedAt: new Date(),
      locale,
      referredById: inviter?.id,
    },
  });
  if (inviter) jar.delete(REFERRAL_COOKIE);
  // Servers friends shared with this address before it had an account.
  await linkInvites(user.id, email);

  await signIn("credentials", { email, password, redirectTo: afterSignIn(form) });
  return {};
}

/** "Sign in with Google" on both log-in and sign-up: the account is found, linked or made on the way back. */
export async function googleSignIn(form: FormData) {
  await signIn("google", { redirectTo: afterSignIn(form) });
}

export async function logIn(_: FormState, form: FormData): Promise<FormState> {
  const email = credentialsSchema.shape.email.safeParse(String(form.get("email") ?? "").trim());
  if (email.success && loginLimited(email.data, clientIp(await headers()))) {
    return { error: "tooManyAttempts", email: String(form.get("email") ?? "") };
  }
  try {
    await signIn("credentials", {
      email: form.get("email"),
      password: form.get("password"),
      redirectTo: afterSignIn(form),
    });
  } catch (err) {
    // signIn throws a redirect on success; only swallow real auth failures.
    if (err instanceof AuthError) {
      return { error: "wrongCredentials", email: String(form.get("email") ?? "") };
    }
    throw err;
  }
  return {};
}

// Always answers "sent", whether or not the account exists, so the form can't
// be used to find out who has one. The email goes out in the background for
// the same reason: waiting for it would make known addresses answer slower.
export async function requestPasswordReset(_: FormState, form: FormData): Promise<FormState> {
  const raw = String(form.get("email") ?? "");
  const parsed = credentialsSchema.shape.email.safeParse(raw.trim());
  if (!parsed.success) return { error: "invalidEmail", email: raw };
  const email = parsed.data;
  const resetKey = `reset:ip:${clientIp(await headers())}`;
  if (isLimited(resetKey, RESETS_PER_IP.max, RESETS_PER_IP.windowMs)) return { error: "tooManyAttempts", email: raw };
  hit(resetKey);

  const token = await createResetToken(email);
  if (token) {
    const t = (await getMessages()).auth.resetMail;
    const url = `${process.env.APP_URL ?? "http://localhost:3000"}/nowe-haslo?token=${token}`;
    const vars = { brand: BRAND_NAME, email, minutes: RESET_LINK_MINUTES };
    const mail = buttonMail({
      to: email,
      subject: format(t.subject, vars),
      paragraphs: [format(t.intro, vars), format(t.action, vars)],
      button: t.button,
      url,
      footer: t.ignore,
    });
    sendMail(mail).catch((err) => console.error(`[mail] password reset email to ${email} failed:`, err));
  }
  return { sent: true, email };
}

export async function setNewPassword(_: FormState, form: FormData): Promise<FormState> {
  const password = String(form.get("password") ?? "");
  if (!credentialsSchema.shape.password.safeParse(password).success) return { error: "passwordTooShort" };
  if (password !== form.get("confirm")) return { error: "passwordsDiffer" };

  const email = await resetPassword(String(form.get("token") ?? ""), password);
  if (!email) return { error: "linkInvalid" };
  await signIn("credentials", { email, password, redirectTo: "/dashboard?haslo=zmienione" });
  return {};
}

/** "Change password" in the dashboard: the current password, then the new one twice. */
export async function changePasswordAction(_: FormState, form: FormData): Promise<FormState> {
  const session = await getSession();
  const userId = session?.user?.id;
  const email = session?.user?.email;
  if (!userId || !email) redirect("/login");
  const password = String(form.get("password") ?? "");
  if (!credentialsSchema.shape.password.safeParse(password).success) return { error: "passwordTooShort" };
  if (password !== form.get("confirm")) return { error: "passwordsDiffer" };
  // Same limit as wrong passwords at sign-in, so a left-open session can't be used to guess it.
  const key = `pwchange:${userId}`;
  if (isLimited(key, LOGIN_PER_EMAIL.max, LOGIN_PER_EMAIL.windowMs)) return { error: "tooManyAttempts" };
  if ((await changePassword(userId, String(form.get("current") ?? ""), password)) !== "ok") {
    hit(key);
    return { error: "wrongPassword" };
  }
  // Signs this device in again, so only the other devices are logged out.
  await signIn("credentials", { email, password, redirectTo: "/dashboard?haslo=zmienione" });
  return {};
}

export async function logOut() {
  // This device stops getting the account's notifications; signing in again turns them back on.
  const [session, jar] = await Promise.all([auth(), cookies()]);
  const endpoint = jar.get(PUSH_COOKIE)?.value;
  if (endpoint && session?.user?.id) {
    await db.pushSubscription.deleteMany({ where: { endpoint, userId: session.user.id } });
  }
  await signOut({ redirectTo: "/" });
}

const YEAR = 60 * 60 * 24 * 365;

export async function setPreferences(form: FormData) {
  const jar = await cookies();
  const locale = form.get("locale");
  const currency = form.get("currency");
  if (isLocale(locale)) {
    jar.set(LOCALE_COOKIE, locale, { maxAge: YEAR, sameSite: "lax", path: "/" });
    // Emails follow the language the user reads the site in.
    const userId = (await auth())?.user?.id;
    if (userId) await db.user.updateMany({ where: { id: userId }, data: { locale } });
  }
  if (isCurrency(currency)) jar.set(CURRENCY_COOKIE, currency, { maxAge: YEAR, sameSite: "lax", path: "/" });
  revalidatePath("/", "layout");
}
