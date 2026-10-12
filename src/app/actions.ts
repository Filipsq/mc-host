"use server";

import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { AuthError } from "next-auth";
import { db } from "@/lib/db";
import { credentialsSchema } from "@/lib/credentials";
import { signIn, signOut } from "@/auth";
import { CURRENCY_COOKIE, LOCALE_COOKIE, isCurrency, isLocale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";

export type AuthErrorCode = keyof Messages["auth"]["errors"];

// email is echoed back so the form keeps it after React resets inputs on submit.
export type FormState = { error?: AuthErrorCode; email?: string };

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
  await db.user.create({
    data: { email, passwordHash: await bcrypt.hash(password, 12), termsAcceptedAt: new Date() },
  });

  await signIn("credentials", { email, password, redirectTo: "/dashboard" });
  return {};
}

export async function logIn(_: FormState, form: FormData): Promise<FormState> {
  try {
    await signIn("credentials", {
      email: form.get("email"),
      password: form.get("password"),
      redirectTo: "/dashboard",
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

export async function logOut() {
  await signOut({ redirectTo: "/" });
}

const YEAR = 60 * 60 * 24 * 365;

export async function setPreferences(form: FormData) {
  const jar = await cookies();
  const locale = form.get("locale");
  const currency = form.get("currency");
  if (isLocale(locale)) jar.set(LOCALE_COOKIE, locale, { maxAge: YEAR, sameSite: "lax", path: "/" });
  if (isCurrency(currency)) jar.set(CURRENCY_COOKIE, currency, { maxAge: YEAR, sameSite: "lax", path: "/" });
  revalidatePath("/", "layout");
}
