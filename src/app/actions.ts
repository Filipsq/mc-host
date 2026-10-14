"use server";

import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
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
import { RESET_LINK_MINUTES, createResetToken, resetPassword } from "@/lib/passwordReset";
import { linkInvites } from "@/lib/access";
import { REFERRAL_COOKIE, inviterFor } from "@/lib/referrals";

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

export async function logIn(_: FormState, form: FormData): Promise<FormState> {
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

export async function logOut() {
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
