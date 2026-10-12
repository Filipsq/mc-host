"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Plan, ServerStatus } from "@prisma/client";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import * as agent from "@/lib/agent";
import { agentSpec, createServerRecord, destroyServer, getOwnedServer, isValidSubdomain } from "@/lib/servers";
import { planById } from "@/lib/plans";
import { startCheckout } from "@/lib/billing";
import { PERIOD_DAYS, type PeriodDays } from "@/lib/periods";
import { canSellMemory, heldMemoryMb } from "@/lib/capacity";
import {
  DIFFICULTIES,
  GAME_MODES,
  JAVA_VERSIONS,
  MOTD_MAX,
  WHITELIST_MAX,
  isValidPlayerName,
  parsePlayers,
} from "@/lib/settings";
import { CURATED_PACKS, MODPACK_MIN_PLAN, SERVER_KINDS, parseModrinthLink, planAtLeast } from "@/lib/modpacks";
import { type ResolvedPack, resolveModpack } from "@/lib/modrinth";
import { getMessages, getPreferences } from "@/i18n/server";
import { format, type Messages } from "@/i18n/messages";

export type ServerErrorCode = keyof Messages["server"]["errors"];
export type CreateServerState = { error?: ServerErrorCode; values?: Record<string, string> };

const planField = z.enum(["FREE", "STARTER", "STANDARD", "PRO"]);
const daysField = z.coerce
  .number()
  .refine((d): d is PeriodDays => (PERIOD_DAYS as readonly number[]).includes(d))
  .transform((d) => d as PeriodDays);

const createSchema = z.object({
  name: z
    .string()
    .trim()
    .regex(/^[\p{L}\p{N} _-]{3,32}$/u),
  edition: z.enum(["JAVA", "BEDROCK"]),
  plan: planField,
  days: daysField,
  subdomain: z.string().trim().toLowerCase().optional(),
  kind: z.enum(SERVER_KINDS).default("vanilla"),
  pack: z.string().optional(), // a curated pack's slug, or "custom" for packLink
  packLink: z.string().max(300).optional(),
});

async function requireUser() {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  return { id: session.user.id, email: session.user.email ?? "" };
}

async function checkoutUrl(user: { id: string; email: string }, server: { id: string; name: string }, plan: z.infer<typeof planField>, days: PeriodDays) {
  const [{ locale, currency }, t] = await Promise.all([getPreferences(), getMessages()]);
  // Emails about this payment go out in the language it was made in.
  await db.user.updateMany({ where: { id: user.id }, data: { locale } });
  return startCheckout({
    user,
    server,
    plan,
    days,
    currency,
    locale,
    productName: format(t.billing.productName, { plan: t.plans[plan], server: server.name, days }),
    // Both checkout forms require the start-now consent before getting here.
    startConsent: true,
  });
}

export async function createServerAction(_: CreateServerState, form: FormData): Promise<CreateServerState> {
  const user = await requireUser();
  const values = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  const parsed = createSchema.safeParse(values);
  if (!parsed.success) {
    const field = parsed.error.issues[0].path[0];
    const error =
      field === "edition" ? "invalidEdition" : field === "name" ? "invalidName" : field === "kind" ? "invalidKind" : "invalidPlan";
    return { error, values };
  }
  const { name, edition, plan, days } = parsed.data;
  const subdomain = edition === "JAVA" ? (parsed.data.subdomain ?? "") : null;
  if (subdomain !== null && !isValidSubdomain(subdomain)) return { error: "invalidSubdomain", values };

  if (plan === "FREE" && (await db.server.count({ where: { ownerId: user.id, plan: "FREE" } }))) {
    return { error: "freeLimit", values };
  }
  if (plan !== "FREE" && form.get("startNow") !== "on") return { error: "consentRequired", values };

  // Bedrock has no game modes or mod packs here.
  const kind = edition === "JAVA" ? parsed.data.kind : "vanilla";
  let modpackRef: { slug: string; version?: string } | null = null;
  if (kind === "modpack") {
    const curated = CURATED_PACKS.find((p) => p.slug === parsed.data.pack);
    modpackRef = curated ? { slug: curated.slug } : parseModrinthLink(parsed.data.packLink ?? "");
    if (!modpackRef) return { error: "modpackLink", values };
    const minPlan = curated?.minPlan ?? MODPACK_MIN_PLAN;
    if (!planAtLeast(plan, minPlan)) return { error: minPlan === "STARTER" ? "modpackPaidOnly" : "modpackNeedsStandard", values };
  }

  const memoryMb = planById(plan).ramGb * 1024;
  if (plan !== "FREE" && !(await canSellMemory(memoryMb))) return { error: "soldOut", values };

  // Pin the pack's current version, so players know exactly which one to install.
  let pack: ResolvedPack | null = null;
  if (modpackRef) {
    const resolved = await resolveModpack(modpackRef);
    if (typeof resolved === "string") return { error: resolved, values };
    pack = resolved;
  }

  const server = await createServerRecord({
    ownerId: user.id,
    name,
    edition,
    subdomain,
    plan,
    memoryMb,
    kind,
    ...(pack && {
      version: pack.gameVersion,
      modpack: pack.slug,
      modpackTitle: pack.title,
      modpackVersionId: pack.versionId,
      modpackVersion: pack.versionNumber,
      modpackLoader: pack.loader,
    }),
    // Paid servers are only created on the game host once Stripe confirms payment.
    status: plan === "FREE" ? "PROVISIONING" : "AWAITING_PAYMENT",
  });
  if (server === "subdomainTaken") return { error: "subdomainTaken", values };
  if (!server) return { error: "noPorts", values };

  if (plan !== "FREE") {
    let url: string;
    try {
      url = await checkoutUrl(user, server, plan, days);
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
    if (!agent.isFull(err)) console.error("create server failed", server.id, err);
    // Clean up anything half-created so the user can try again.
    await agent.deleteServer(server.id).catch(() => {});
    await db.server.delete({ where: { id: server.id } });
    return { error: agent.isFull(err) ? "full" : "agentUnavailable", values };
  }

  await db.server.update({ where: { id: server.id }, data: { status: "RUNNING" } });
  redirect(`/dashboard/servers/${server.id}`);
}

export type CheckoutState = { error?: ServerErrorCode };

const checkoutSchema = z.object({ plan: planField.exclude(["FREE"]), days: daysField });

/** Pays for a server: first payment, renewal, or plan change. */
export async function checkoutAction(id: string, _: CheckoutState, form: FormData): Promise<CheckoutState> {
  const user = await requireUser();
  const server = await getOwnedServer(id, user.id);
  if (!server) redirect("/dashboard");
  const parsed = checkoutSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "invalidPlan" };
  if (form.get("startNow") !== "on") return { error: "consentRequired" };
  // Renewing the same plan needs nothing new; an upgrade only needs the difference.
  if (!(await canSellMemory(planById(parsed.data.plan).ramGb * 1024 - heldMemoryMb(server)))) {
    return { error: "soldOut" };
  }

  let url: string;
  try {
    url = await checkoutUrl(user, server, parsed.data.plan, parsed.data.days);
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

export async function startServerAction(id: string): Promise<{ error?: ServerErrorCode }> {
  const server = await ownedOrThrow(id);
  // Unpaid servers stay off until someone pays.
  if (server.status === "SUSPENDED" || server.status === "AWAITING_PAYMENT") return {};
  try {
    // Plugins changed while it ran: rebuild it with the new list on the way up.
    if (server.pluginsPending) await agent.recreateServer(agentSpec(server));
    else await agent.startServer(server.id);
  } catch (err) {
    if (agent.isFull(err)) return { error: "full" };
    if (agent.isDiskFull(err)) {
      revalidatePath(`/dashboard/servers/${id}`);
      return { error: "diskFull" };
    }
    throw err;
  }
  await db.server.update({ where: { id: server.id }, data: { status: "RUNNING", pluginsPending: false } });
  revalidatePath(`/dashboard/servers/${id}`);
  return {};
}

export async function stopServerAction(id: string) {
  const server = await ownedOrThrow(id);
  await agent.stopServer(server.id);
  await db.server.update({ where: { id: server.id }, data: { status: "STOPPED" } });
  revalidatePath(`/dashboard/servers/${id}`);
}

export async function deleteServerAction(id: string) {
  await destroyServer(await ownedOrThrow(id));
  redirect("/dashboard");
}

export type BackupResult = { error?: ServerErrorCode };

const BACKUP_NAME = /^\d{8}-\d{6}\.tar\.gz$/;
const BACKUP_COOLDOWN_MS = 15 * 60_000;

/** Whether the panel may make or restore backups (a paid plan that's paid up). */
function backupsAllowed(server: { plan: Plan; status: ServerStatus }) {
  return planById(server.plan).backupsKept > 0 && server.status !== "SUSPENDED" && server.status !== "AWAITING_PAYMENT";
}

/** Backs up the world now. One every few minutes is plenty, so closer ones are refused. */
export async function createBackupAction(id: string): Promise<BackupResult> {
  const server = await ownedOrThrow(id);
  if (!backupsAllowed(server)) return { error: "backupFailed" };
  try {
    const { backups } = await agent.listBackups(server.id);
    if (backups[0] && Date.now() - Date.parse(backups[0].createdAt) < BACKUP_COOLDOWN_MS) return { error: "tooSoon" };
    await agent.createBackup(server.id);
  } catch (err) {
    console.error("backup failed", server.id, err);
    return { error: "backupFailed" };
  }
  revalidatePath(`/dashboard/servers/${id}`);
  return {};
}

export async function restoreBackupAction(id: string, name: string): Promise<BackupResult> {
  const server = await ownedOrThrow(id);
  if (!backupsAllowed(server) || !BACKUP_NAME.test(name)) return { error: "restoreFailed" };
  try {
    await agent.restoreBackup(server.id, name);
  } catch (err) {
    console.error("restore failed", server.id, name, err);
    return { error: "restoreFailed" };
  }
  revalidatePath(`/dashboard/servers/${id}`);
  return {};
}

export type SettingsState = { error?: keyof Messages["settings"]["errors"]; player?: string };

const settingsSchema = z.object({
  version: z.string().optional(),
  gameMode: z.enum(GAME_MODES),
  difficulty: z.enum(DIFFICULTIES),
  motd: z.string().trim(),
  pvp: z.literal("on").optional(),
  whitelist: z.literal("on").optional(),
  players: z.string().default(""),
});

/** Saves the game settings and rebuilds the server with them (a running one restarts). */
export async function saveSettingsAction(id: string, _: SettingsState, form: FormData): Promise<SettingsState> {
  const server = await ownedOrThrow(id);
  const parsed = settingsSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "invalidSettings" };
  const s = parsed.data;
  const java = server.edition === "JAVA";

  // Bedrock always runs the newest version, game modes follow their plugins and mod packs
  // their pack; plain Java keeps its version unless a listed one is picked.
  const pickable = java && server.kind === "vanilla";
  const version =
    pickable && s.version && (JAVA_VERSIONS.includes(s.version) || s.version === server.version) ? s.version : server.version;
  if (s.motd.length > MOTD_MAX || /[\p{Cc}]/u.test(s.motd)) return { error: "motdTooLong" };
  const players = parsePlayers(s.players);
  const bad = players.find((p) => !isValidPlayerName(server.edition, p));
  if (bad) return { error: "invalidPlayer", player: bad };
  if (players.length > WHITELIST_MAX) return { error: "tooManyPlayers" };
  const whitelist = s.whitelist === "on";
  if (whitelist && players.length === 0) return { error: "whitelistEmpty" };

  const updated = await db.server.update({
    where: { id: server.id },
    data: {
      version,
      gameMode: s.gameMode,
      difficulty: s.difficulty,
      motd: s.motd,
      pvp: java ? s.pvp === "on" : server.pvp,
      whitelist,
      whitelistPlayers: players,
    },
  });

  // Unpaid servers aren't on the game host; they get these settings when they're (re)created.
  if (["RUNNING", "STOPPED", "SLEEPING"].includes(server.status)) {
    try {
      if (version !== server.version && planById(server.plan).backupsKept > 0) {
        await agent.createBackup(server.id).catch((err) => console.error("pre-update backup failed", server.id, err));
      }
      await agent.recreateServer(agentSpec(updated), { keepStopped: true });
    } catch (err) {
      console.error("apply settings failed", server.id, err);
      return { error: "applyFailed" };
    }
    // The rebuild brought the plugin list up to date too.
    if (updated.pluginsPending) await db.server.update({ where: { id: server.id }, data: { pluginsPending: false } });
  }
  revalidatePath(`/dashboard/servers/${id}`);
  redirect(`/dashboard/servers/${id}?settings=saved`);
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
