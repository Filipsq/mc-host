"use server";

import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { db } from "@/lib/db";
import { credentialsSchema } from "@/lib/credentials";
import { signIn, signOut } from "@/auth";

// email is echoed back so the form keeps it after React resets inputs on submit.
export type FormState = { error?: string; email?: string };

export async function signUp(_: FormState, form: FormData): Promise<FormState> {
  const parsed = credentialsSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message, email: String(form.get("email") ?? "") };

  const { email, password } = parsed.data;
  if (await db.user.findUnique({ where: { email } })) {
    return { error: "An account with that email already exists", email };
  }
  await db.user.create({ data: { email, passwordHash: await bcrypt.hash(password, 12) } });

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
      return { error: "Wrong email or password", email: String(form.get("email") ?? "") };
    }
    throw err;
  }
  return {};
}

export async function logOut() {
  await signOut({ redirectTo: "/" });
}
