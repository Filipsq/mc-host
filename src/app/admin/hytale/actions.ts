"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { disconnect, pollDeviceLogin, startDeviceLogin, type HytaleAuthKind } from "@/lib/hytale";

const kindOf = (k: string): HytaleAuthKind => (k === "downloader" ? "downloader" : "server");

/** Starts signing the admin's Hytale account in: the page then shows the code. */
export async function startHytaleLoginAction(kind: string): Promise<{ error?: "failed" }> {
  await requireAdmin();
  try {
    await startDeviceLogin(kindOf(kind));
  } catch (err) {
    console.error("hytale login start failed", err);
    return { error: "failed" };
  }
  revalidatePath("/admin/hytale");
  return {};
}

/** Asks Hytale whether the admin finished signing in on its page. */
export async function pollHytaleLoginAction(kind: string) {
  await requireAdmin();
  const result = await pollDeviceLogin(kindOf(kind)).catch((err) => {
    console.error("hytale login poll failed", err);
    return "failed" as const;
  });
  if (result !== "pending") revalidatePath("/admin/hytale");
  return result;
}

export async function disconnectHytaleAction(kind: string) {
  await requireAdmin();
  await disconnect(kindOf(kind));
  revalidatePath("/admin/hytale");
}
