"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { checkUnsubscribe } from "@/lib/comeback";

/** Turns "come back and play" reminders off or back on, from the link in the email. */
export async function setComeback(form: FormData) {
  const u = form.get("u")?.toString() ?? null;
  const t = form.get("t")?.toString() ?? null;
  if (!checkUnsubscribe(u, t)) redirect("/wypisz");
  await db.user.updateMany({ where: { id: u }, data: { comebackOff: form.get("off") === "1" } });
  redirect(`/wypisz?u=${encodeURIComponent(u)}&t=${encodeURIComponent(t!)}`);
}
