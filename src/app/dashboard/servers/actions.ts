"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import * as agent from "@/lib/agent";
import { agentSpec, createServerRecord, getOwnedServer, isValidSubdomain } from "@/lib/servers";
import { planById } from "@/lib/plans";
import { PERIOD_MONTHS, startCheckout } from "@/lib/billing";
import { getMessages, getPreferences } from "@/i18n/server";
import { format, type Messages } from "@/i18n/messages";

export type ServerErrorCode = keyof Messages["server"]["errors"];
export type CreateServerState = { error?: ServerErrorCode; values?: Record<string, string> };

const planField = z.enum(["FREE", "STARTER", "STANDARD", "PRO"]);
const monthsField = z.coerce.number().pipe(z.union(PERIOD_MONTHS.map((m) => z.literal(m))));

const createSchema = z.object({
  name: z
    .string()
    .trim()
    .regex(/^[\p{L}\p{N} _-]{3,32}$/u),
  edition: z.enum(["JAVA", "BEDROCK"]),
  plan: planField,
  months: monthsField,
  subdomain: z.string().trim().toLowerCase().optional(),
});

async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return { id: session.user.id, email: session.user.email ?? "" };
}

async function checkoutUrl(user: { id: string; email: string }, server: { id: string; name: string }, plan: z.infer<typeof planField>, months: (typeof PERIOD_MONTHS)[number]) {
  const [{ locale, currency }, t] = await Promise.all([getPreferences(), getMessages()]);
  return startCheckout({
    user,
    server,
    plan,
    months,
    currency,
    locale,
    productName: format(t.billing.productName, { plan: t.plans[plan], server: server.name, months }),
  });
}

export async function createServerAction(_: CreateServerState, form: FormData): Promise<CreateServerState> {
  const user = await requireUser();
  const values = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const parsed = createSchema.safeParse(values);
  if (!parsed.success) {
    const field = parsed.error.issues[0].path[0];
    const error = field === "edition" ? "invalidEdition" : field === "name" ? "invalidName" : "invalidPlan";
    return { error, values };
  }
  const { name, edition, plan, months } = parsed.data;
  const subdomain = edition === "JAVA" ? (parsed.data.subdomain ?? "") : null;
  if (subdomain !== null && !isValidSubdomain(subdomain)) return { error: "invalidSubdomain", values };

  if (plan === "FREE" && (await db.server.count({ where: { ownerId: user.id, plan: "FREE" } }))) {
    return { error: "freeLimit", values };
  }

  const server = await createServerRecord({
    ownerId: user.id,
    name,
    edition,
    subdomain,
    plan,
    memoryMb: planById(plan).ramGb * 1024,
    // Paid servers are only created on the game host once Stripe confirms payment.
    status: plan === "FREE" ? "PROVISIONING" : "AWAITING_PAYMENT",
  });
  if (server === "subdomainTaken") return { error: "subdomainTaken", values };
  if (!server) return { error: "noPorts", values };

  if (plan !== "FREE") {
    let url: string;
    try {
      url = await checkoutUrl(user, server, plan, months);
    } catch (err) {
      console.error("checkout failed", server.id, err);
      await db.server.delete({ where: { id: server.id } });
      return { error: "paymentsUnavailable", values };
    }
    redirect(url);
  }

  try {
    await agent.createServer(agentSpec(server));
  } catch (err) {
    console.error("create server failed", server.id, err);
    // Clean up anything half-created so the user can try again.
    await agent.deleteServer(server.id).catch(() => {});
    await db.server.delete({ where: { id: server.id } });
    return { error: "agentUnavailable", values };
  }

  await db.server.update({ where: { id: server.id }, data: { status: "RUNNING" } });
  redirect(`/dashboard/servers/${server.id}`);
}

export type CheckoutState = { error?: ServerErrorCode };

const checkoutSchema = z.object({ plan: planField.exclude(["FREE"]), months: monthsField });

/** Pays for a server: first payment, renewal, or plan change. */
export async function checkoutAction(id: string, _: CheckoutState, form: FormData): Promise<CheckoutState> {
  const user = await requireUser();
  const server = await getOwnedServer(id, user.id);
  if (!server) redirect("/dashboard");
  const parsed = checkoutSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "invalidPlan" };

  let url: string;
  try {
    url = await checkoutUrl(user, server, parsed.data.plan, parsed.data.months);
  } catch (err) {
    console.error("checkout failed", server.id, err);
    return { error: "paymentsUnavailable" };
  }
  redirect(url);
}

async function ownedOrThrow(id: string) {
  const server = await getOwnedServer(id, (await requireUser()).id);
  if (!server) throw new Error("Server not found");
  return server;
}

export async function startServerAction(id: string) {
  const server = await ownedOrThrow(id);
  // Unpaid servers stay off until someone pays.
  if (server.status === "SUSPENDED" || server.status === "AWAITING_PAYMENT") return;
  await agent.startServer(server.id);
  await db.server.update({ where: { id: server.id }, data: { status: "RUNNING" } });
  revalidatePath(`/dashboard/servers/${id}`);
}

export async function stopServerAction(id: string) {
  const server = await ownedOrThrow(id);
  await agent.stopServer(server.id);
  await db.server.update({ where: { id: server.id }, data: { status: "STOPPED" } });
  revalidatePath(`/dashboard/servers/${id}`);
}

export async function deleteServerAction(id: string) {
  const server = await ownedOrThrow(id);
  await agent.deleteServer(server.id).catch((err) => {
    // Never created on the game host (e.g. unpaid): nothing to remove there.
    if (!(err instanceof agent.AgentError && err.status === 404)) throw err;
  });
  await db.server.delete({ where: { id: server.id } });
  redirect("/dashboard");
}

export type CommandResult = { output?: string; error?: ServerErrorCode };

export async function sendCommandAction(id: string, command: string): Promise<CommandResult> {
  const server = await ownedOrThrow(id);
  const trimmed = command.trim().replace(/^\//, "");
  if (!trimmed || trimmed.length > 500) return { error: "commandFailed" };
  try {
    return { output: await agent.sendCommand(server.id, trimmed) };
  } catch (err) {
    if (err instanceof agent.AgentError && err.status === 409) return { error: "notRunning" };
    console.error("command failed", server.id, err);
    return { error: "commandFailed" };
  }
}
