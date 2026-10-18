"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Plan, ServerStatus } from "@prisma/client";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import * as agent from "@/lib/agent";
import { agentSpec, applyToHost, createServerRecord, destroyServer, getOwnedServer, isValidSubdomain, onHost } from "@/lib/servers";
import { getServerFor, type ServerNeed } from "@/lib/access";
import { planById } from "@/lib/plans";
import { startCheckout } from "@/lib/billing";
import { PERIOD_DAYS, type PeriodDays } from "@/lib/periods";
import { canSellMemory, heldMemoryMb } from "@/lib/capacity";
import { isAdmin } from "@/lib/admin";
import {
  DIFFICULTIES,
  GAME_MODES,
  LOADER_VERSIONS,
  MOD_DEFAULT_VERSION,
  MOTD_MAX,
  WHITELIST_MAX,
  isValidPlayerName,
  parsePlayers,
  versionsFor,
} from "@/lib/settings";
import { CURATED_PACKS, MODPACK_MIN_PLAN, MOD_LOADERS, planAtLeast, planForRam } from "@/lib/modpacks";
import { GAME_IDS, gameById } from "@/lib/games";
import { KNOWN_PLUGINS, PLUGIN_SETS, canCrossplay, canRunNonPremium, pluginIds, setFits, supportsPlugins, type KnownPlugin } from "@/lib/plugins";
import { type PackChoice, packFields, packNamed, resolvePackChoice } from "@/lib/packChoice";
import { SERVER_PASSWORD, TERRARIA_KINDS, WORLD_DIFFICULTIES, WORLD_SEED, WORLD_SIZES } from "@/lib/terraria";
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
  edition: z.enum(["JAVA", "BEDROCK", "TERRARIA"]),
  plan: planField,
  days: daysField,
  subdomain: z.string().trim().toLowerCase().optional(),
  game: z.enum(GAME_IDS).default("survival"),
  pack: z.string().optional(), // a curated pack's slug, "custom" for packLink, or "curseforge" for cfPack
  packLink: z.string().max(300).optional(),
  cfPack: z.string().max(64).optional(), // a CurseForge pack's slug, from the home page

  // For the "mods" game: which loader, on which Minecraft version.
  loader: z.enum(MOD_LOADERS).default("fabric"),
  modVersion: z.string().max(20).optional(),
  // Settings and extra plugins the AI creator picked; otherwise the defaults.
  gameMode: z.enum(GAME_MODES).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  pvp: z.enum(["on", "off"]).optional(),
  motd: z.string().trim().max(MOTD_MAX).optional(),
  extraPlugins: z.string().max(500).optional(), // comma-separated KNOWN_PLUGINS keys
  nonPremium: z.literal("on").optional(),
  crossplay: z.literal("on").optional(),

  // Terraria: the server's type and its world, which is made on the first start.
  terrariaKind: z.enum(TERRARIA_KINDS).default("vanilla"),
  worldSize: z.enum(WORLD_SIZES).default("medium"),
  worldDifficulty: z.enum(WORLD_DIFFICULTIES).default("classic"),
  seed: z.string().trim().max(100).default(""),
  password: z.string().max(100).default(""),
});

const MODPACK_PLAN_ERRORS = {
  FREE: "modpackPaidOnly",
  STARTER: "modpackPaidOnly",
  STANDARD: "modpackNeedsStandard",
  PRO: "modpackNeedsPro",
} as const satisfies Record<Plan, ServerErrorCode>;

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
      field === "edition" ? "invalidEdition" : field === "name" ? "invalidName" : field === "game" ? "invalidKind" : "invalidPlan";
    return { error, values };
  }
  const { name, edition, plan, days } = parsed.data;
  const subdomain = edition === "JAVA" ? (parsed.data.subdomain ?? "") : null;
  if (subdomain !== null && !isValidSubdomain(subdomain)) return { error: "invalidSubdomain", values };
  const terraria = edition === "TERRARIA";
  if (terraria && parsed.data.seed && !WORLD_SEED.test(parsed.data.seed)) return { error: "invalidSeed", values };
  if (terraria && parsed.data.password && !SERVER_PASSWORD.test(parsed.data.password)) return { error: "invalidPassword", values };

  if (plan === "FREE" && (await db.server.count({ where: { ownerId: user.id, plan: "FREE" } }))) {
    return { error: "freeLimit", values };
  }
  if (plan !== "FREE" && form.get("startNow") !== "on") return { error: "consentRequired", values };

  // Bedrock and Terraria have no ready games or mod packs here.
  const game = gameById(edition === "JAVA" ? parsed.data.game : "survival");
  // Mods run on the loader the owner picked, on a version it supports.
  const kind = terraria ? parsed.data.terrariaKind : game.id === "mods" ? parsed.data.loader : game.kind;
  const modVersion =
    game.id === "mods"
      ? LOADER_VERSIONS[parsed.data.loader].find((v) => v === parsed.data.modVersion) ?? MOD_DEFAULT_VERSION
      : null;
  if (kind === "modpack") {
    if (!packNamed(parsed.data)) return { error: "modpackLink", values };
    const curated = CURATED_PACKS.find((p) => p.slug === parsed.data.pack);
    const minPlan = curated ? planForRam(curated.ramGb) : MODPACK_MIN_PLAN;
    if (!planAtLeast(plan, minPlan)) return { error: MODPACK_PLAN_ERRORS[minPlan], values };
  }

  const memoryMb = planById(plan).ramGb * 1024;
  // Admins may go over the sales limit to test buying; a plan still has to fit on the machine.
  const extraMb = (await isAdmin(user.id)) ? 0 : memoryMb;
  if (plan !== "FREE" && !(await canSellMemory(extraMb, memoryMb))) return { error: "soldOut", values };

  // Pin the pack's current version, so players know exactly which one to install.
  let pack: PackChoice | null = null;
  if (kind === "modpack") {
    const resolved = await resolvePackChoice(parsed.data);
    if (typeof resolved === "string") return { error: resolved, values };
    // A CurseForge pack's size is only known now.
    const minPlan = resolved.ramGb ? planForRam(resolved.ramGb) : MODPACK_MIN_PLAN;
    if (!planAtLeast(plan, minPlan)) return { error: MODPACK_PLAN_ERRORS[minPlan], values };
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
    plugins: edition === "JAVA" ? pluginIds(startingPlugins(game.plugins, kind, parsed.data.extraPlugins)) : [],
    ...(parsed.data.gameMode && !terraria && { gameMode: parsed.data.gameMode }),
    ...(parsed.data.difficulty && !terraria && { difficulty: parsed.data.difficulty }),
    ...(terraria && {
      difficulty: parsed.data.worldDifficulty,
      levelType: parsed.data.worldSize,
      levelSeed: parsed.data.seed || null,
      serverPassword: parsed.data.password || null,
    }),
    ...(parsed.data.motd && { motd: parsed.data.motd }),
    ...(edition === "JAVA" && parsed.data.pvp && { pvp: parsed.data.pvp === "on" }),
    onlineMode: !(parsed.data.nonPremium === "on" && canRunNonPremium({ edition, kind })),
    crossplay: parsed.data.crossplay === "on" && canCrossplay({ edition, kind }),
    ...(modVersion && { version: modVersion }),
    ...(pack && { version: pack.gameVersion, ...packFields(pack) }),
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

/** The game's own plugins plus known extras that fit this kind of server (none without Paper). */
function startingPlugins(base: readonly KnownPlugin[], kind: string, extra: string | undefined): KnownPlugin[] {
  if (!supportsPlugins({ edition: "JAVA", kind })) return [];
  const islandOnly = new Set<string>(PLUGIN_SETS.filter((s) => !setFits(s, kind)).flatMap((s) => s.plugins));
  const extras = (extra ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter((p): p is KnownPlugin => p in KNOWN_PLUGINS && !islandOnly.has(p));
  return [...new Set([...base, ...extras])];
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
  // Admins may go over the sales limit to test buying, as when creating a server.
  const planMb = planById(parsed.data.plan).ramGb * 1024;
  const extraMb = (await isAdmin(user.id)) ? 0 : planMb - heldMemoryMb(server);
  if (!(await canSellMemory(extraMb, planMb))) {
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

/** The server, if the signed-in user may do what's needed with it (see src/lib/access.ts). */
async function serverOrThrow(id: string, need: ServerNeed) {
  const server = await getServerFor(id, (await requireUser()).id, need);
  if (!server) throw new Error("Server not found");
  return server;
}

export async function startServerAction(id: string): Promise<{ error?: ServerErrorCode }> {
  const server = await serverOrThrow(id, "view");
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
  const server = await serverOrThrow(id, "view");
  await agent.stopServer(server.id);
  await db.server.update({ where: { id: server.id }, data: { status: "STOPPED" } });
  revalidatePath(`/dashboard/servers/${id}`);
}

export async function deleteServerAction(id: string) {
  await destroyServer(await serverOrThrow(id, "owner"));
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
  const server = await serverOrThrow(id, "backups");
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
  const server = await serverOrThrow(id, "backups");
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
  nonPremium: z.literal("on").optional(),
  crossplay: z.literal("on").optional(),
});

/** Saves the game settings and rebuilds the server with them (a running one restarts). */
export async function saveSettingsAction(id: string, _: SettingsState, form: FormData): Promise<SettingsState> {
  const server = await serverOrThrow(id, "settings");
  const parsed = settingsSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success || server.edition === "TERRARIA") return { error: "invalidSettings" };
  const s = parsed.data;
  const java = server.edition === "JAVA";

  // Bedrock always runs the newest version, game modes follow their plugins and mod packs
  // their pack; plain Java and mod loaders keep their version unless a listed one is picked.
  const offered = java ? versionsFor(server.kind) : [];
  const version = s.version && (offered.includes(s.version) || s.version === server.version) ? s.version : server.version;
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
      onlineMode: !(canRunNonPremium(server) && s.nonPremium === "on"),
      // Kept as it was on a mod server, which has no checkbox for it.
      crossplay: canCrossplay(server) ? s.crossplay === "on" : server.crossplay,
    },
  });

  try {
    if (onHost(server) && version !== server.version && planById(server.plan).backupsKept > 0) {
      await agent.createBackup(server.id).catch((err) => console.error("pre-update backup failed", server.id, err));
    }
    await applyToHost(updated);
  } catch (err) {
    console.error("apply settings failed", server.id, err);
    return { error: "applyFailed" };
  }
  revalidatePath(`/dashboard/servers/${id}`);
  redirect(`/dashboard/servers/${id}?settings=saved`);
}

const terrariaSettingsSchema = z.object({ motd: z.string().trim(), password: z.string().default("") });

/** Saves a Terraria server's settings (its world is set when made) and rebuilds it with them. */
export async function saveTerrariaSettingsAction(id: string, _: SettingsState, form: FormData): Promise<SettingsState> {
  const server = await serverOrThrow(id, "settings");
  const parsed = terrariaSettingsSchema.safeParse(Object.fromEntries(form));
  if (server.edition !== "TERRARIA" || !parsed.success) return { error: "invalidSettings" };
  const { motd, password } = parsed.data;
  if (motd.length > MOTD_MAX || /[\p{Cc}]/u.test(motd)) return { error: "motdTooLong" };
  if (password && !SERVER_PASSWORD.test(password)) return { error: "invalidPassword" };

  const updated = await db.server.update({ where: { id: server.id }, data: { motd, serverPassword: password || null } });
  try {
    await applyToHost(updated);
  } catch (err) {
    console.error("apply settings failed", server.id, err);
    return { error: "applyFailed" };
  }
  revalidatePath(`/dashboard/servers/${id}`);
  redirect(`/dashboard/servers/${id}?settings=saved`);
}

export type CommandResult = { output?: string; error?: ServerErrorCode };

export async function sendCommandAction(id: string, command: string): Promise<CommandResult> {
  const server = await serverOrThrow(id, "console");
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
