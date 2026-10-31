"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Plan, ServerStatus } from "@prisma/client";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import * as agent from "@/lib/agent";
import {
  agentSpec,
  applyToHost,
  changePort,
  createServerRecord,
  destroyServer,
  getOwnedServer,
  isValidSubdomain,
  onHost,
  startElsewhere,
  syncHostAliases,
  syncPeerRoutes,
  worldTooNew,
} from "@/lib/servers";
import { MAIN_NODE } from "@/lib/nodes";
import { getServerFor, type ServerNeed } from "@/lib/access";
import { planById } from "@/lib/plans";
import { startCheckout, syncDiskLimits } from "@/lib/billing";
import { biggerPlans, canUpgrade, upgradeCost } from "@/lib/upgrade";
import { addonCost, addonList, canBuyAddons, serverAddons, type AddonId } from "@/lib/addons";
import { PERIOD_DAYS, type PeriodDays } from "@/lib/periods";
import { canSellMemory, heldMemoryMb, rankNodes } from "@/lib/capacity";
import { isAdmin } from "@/lib/admin";
import { FREE_STARTER_DAYS, checkCreatorCode, giveBackFreeStarter, takeFreeStarter } from "@/lib/creator";
import { HALLOWEEN_CODE, isHalloweenCode } from "@/lib/halloween";
import { redeemGift, usableGift } from "@/lib/gifts";
import { GIFT_COOKIE } from "@/lib/giftCookie";
import {
  DIFFICULTIES,
  GAME_MODES,
  LOADER_VERSIONS,
  MOD_DEFAULT_VERSION,
  ICON_SIZE,
  MOTD_MAX,
  SPAWN_PROTECTION_MAX,
  VIEW_DISTANCE_MIN,
  viewDistanceDefault,
  viewDistanceMax,
  serverPlayerLimit,
  WHITELIST_MAX,
  isValidPlayerName,
  parsePlayers,
  versionsFor,
} from "@/lib/settings";
import { activeLevel } from "@/lib/worlds";
import { CURATED_PACKS, MODPACK_MIN_PLAN, MOD_LOADERS, isModLoader, planAtLeast, planForRam } from "@/lib/modpacks";
import { repinCurseforgeMods } from "@/lib/curseforge";
import { canChangeFiles } from "@/lib/files";
import { GAME_IDS, gameById } from "@/lib/games";
import { KNOWN_PLUGINS, PLUGIN_SETS, addonType, canCrossplay, canRunNonPremium, isProjectId, pluginIds, setFits, supportsPlugins, type KnownPlugin } from "@/lib/plugins";
import { uninstallableProjects } from "@/lib/modrinth";
import { type PackChoice, packFields, packNamed, resolvePackChoice } from "@/lib/packChoice";
import { SERVER_PASSWORD, TERRARIA_KINDS, TMOD_MIN_PLAN, requiredArch, WORLD_DIFFICULTIES, WORLD_SEED, WORLD_SIZES } from "@/lib/terraria";
import { getMessages, getPreferences } from "@/i18n/server";
import { format, type Messages } from "@/i18n/messages";

export type ServerErrorCode = keyof Messages["server"]["errors"];
export type CreateServerState = { error?: ServerErrorCode; values?: Record<string, string> };

const DAY = 24 * 60 * 60 * 1000;

// What redeeming a gift on a new server can fail with that the form explains.
const GIFT_FORM_ERRORS = { giftInvalid: 1, giftUsed: 1, giftExpired: 1, giftUnpaid: 1, soldOut: 1 } as const;

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
  pack: z.string().optional(), // a curated pack's slug, "custom" for packLink, or "curseforge:<slug>" (or "curseforge" with cfPack)
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

async function checkoutUrl(
  user: { id: string; email: string },
  server: { id: string; name: string },
  plan: z.infer<typeof planField>,
  days: PeriodDays,
  autoRenew = false,
  addons: AddonId[] = [],
  creatorId?: string,
  promoCode?: string,
) {
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
    autoRenew,
    addons,
    creatorId,
    promoCode,
  });
}

/** Add-ons ticked in a form: none on the free plan, and the own domain only for Java (players of other games join by IP and port). */
function formAddons(form: FormData, plan: Plan, edition: string) {
  if (plan === "FREE") return [];
  return addonList(form.getAll("addons").map(String)).filter((a) => a !== "domain" || edition === "JAVA");
}

export async function createServerAction(_: CreateServerState, form: FormData): Promise<CreateServerState> {
  const user = await requireUser();
  const values = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  // Several ticked add-ons share a name; kept together so the form can come back with them.
  values.addons = form.getAll("addons").map(String).join(",");
  const parsed = createSchema.safeParse(values);
  if (!parsed.success) {
    const field = parsed.error.issues[0].path[0];
    const error =
      field === "edition" ? "invalidEdition" : field === "name" ? "invalidName" : field === "game" ? "invalidKind" : "invalidPlan";
    return { error, values };
  }
  const { name, edition, plan, days } = parsed.data;
  const addons = formAddons(form, plan, edition);
  // A hyphen left at the end when someone pressed Enter mid-typing.
  const subdomain = edition === "JAVA" ? (parsed.data.subdomain ?? "").replace(/-+$/, "") : null;
  if (subdomain !== null && !isValidSubdomain(subdomain)) return { error: "invalidSubdomain", values };
  const terraria = edition === "TERRARIA";
  if (terraria && parsed.data.seed && !WORLD_SEED.test(parsed.data.seed)) return { error: "invalidSeed", values };
  if (terraria && parsed.data.password && !SERVER_PASSWORD.test(parsed.data.password)) return { error: "invalidPassword", values };

  // An admin's test server: any plan, without paying, to try things out.
  const adminTest = form.get("adminTest") === "on" && (await isAdmin(user.id));
  if (!adminTest && plan === "FREE" && (await db.server.count({ where: { ownerId: user.id, plan: "FREE", adminTest: false } }))) {
    return { error: "freeLimit", values };
  }
  // A free Starter earned with the creator code: paid for FREE_STARTER_DAYS already, without add-ons.
  // A gift code (gifts.ts): the gift's plan, paid for with it once the server exists.
  const giftCode = adminTest ? "" : String(form.get("giftCode") ?? "").trim();
  if (giftCode) {
    const found = await usableGift(giftCode);
    if ("error" in found) return { error: found.error, values };
    if (found.gift.plan !== plan) return { error: "giftPlan", values };
  }
  const freeStarter = !adminTest && !giftCode && form.get("freeStarter") === "on";
  if (freeStarter && plan !== "STARTER") return { error: "freeStarterPlan", values };
  const paying = plan !== "FREE" && !adminTest && !freeStarter && !giftCode;
  if (paying && form.get("startNow") !== "on") return { error: "consentRequired", values };
  // Someone's creator code: a tenth off this first payment, and the server counts for them.
  // Or the Halloween code (halloween.ts), typed in the same field: a fifth off.
  const code = paying ? String(form.get("creatorCode") ?? "").trim() : "";
  const promoCode = code && isHalloweenCode(code) ? HALLOWEEN_CODE : undefined;
  const creator = code && !promoCode ? await checkCreatorCode(code, user.id) : null;
  if (creator && "error" in creator) return { error: creator.error, values };

  // Bedrock and Terraria have no ready games or mod packs here.
  const game = gameById(edition === "JAVA" ? parsed.data.game : "survival");
  // Mods run on the loader the owner picked, on a version it supports.
  const kind = terraria ? parsed.data.terrariaKind : game.id === "mods" ? parsed.data.loader : game.kind;
  const modVersion =
    game.id === "mods"
      ? LOADER_VERSIONS[parsed.data.loader].find((v) => v === parsed.data.modVersion) ?? MOD_DEFAULT_VERSION
      : null;
  // tModLoader needs more memory than the free plan has, and an x86 machine (rankNodes below).
  const tmod = terraria && kind === "tmodloader";
  if (tmod && !planAtLeast(plan, TMOD_MIN_PLAN)) return { error: "tmodPaidOnly", values };
  if (kind === "modpack") {
    if (!packNamed(parsed.data)) return { error: "modpackLink", values };
    const curated = CURATED_PACKS.find((p) => p.slug === parsed.data.pack);
    const minPlan = curated ? planForRam(curated.ramGb) : MODPACK_MIN_PLAN;
    if (!planAtLeast(plan, minPlan)) return { error: MODPACK_PLAN_ERRORS[minPlan], values };
  }

  const memoryMb = planById(plan).ramGb * 1024;
  // Admins may go over the sales limit to test buying; a plan still has to fit on the machine.
  const extraMb = (await isAdmin(user.id)) ? 0 : memoryMb;
  // The machine it goes on: the one with the most room (paid plans need room to sell).
  // Bedrock and tModLoader need an x86 machine.
  const candidates = await rankNodes(memoryMb, plan === "FREE" ? 0 : extraMb, undefined, requiredArch({ edition, kind }));
  const node = candidates[0];
  if (!node) return { error: "soldOut", values };

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

  let server = await createServerRecord({
    ownerId: user.id,
    node,
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
    onlineMode: !(parsed.data.nonPremium === "on" && canRunNonPremium({ edition, kind, version: modVersion ?? "LATEST" })),
    crossplay: parsed.data.crossplay === "on" && canCrossplay({ edition, kind }),
    ...("version" in game && { version: game.version }),
    ...(modVersion && { version: modVersion }),
    ...(pack && { version: pack.gameVersion, ...packFields(pack) }),
    // Paid servers are only created on the game host once Stripe confirms payment (or the gift code pays).
    status: paying || giftCode ? "AWAITING_PAYMENT" : "PROVISIONING",
    ...(adminTest && { adminTest, addons, ...(plan !== "FREE" && { paidUntil: new Date(Date.now() + days * DAY) }) }),
    ...(freeStarter && { paidUntil: new Date(Date.now() + FREE_STARTER_DAYS * DAY) }),
    ...(creator && { creatorId: creator.creatorId }),
    ...(promoCode && { promoCode }),
  });
  if (server === "subdomainTaken") return { error: "subdomainTaken", values };
  if (!server) return { error: "noPorts", values };
  // Taken only now the server exists, and given back if it can't start below.
  if (freeStarter && !(await takeFreeStarter(user.id))) {
    await db.server.delete({ where: { id: server.id } });
    return { error: "noFreeStarter", values };
  }
  // On another machine, Java players reach it through the main machine's router.
  if (server.node !== MAIN_NODE) await syncPeerRoutes().catch((err) => console.error("peer routes not sent", err));

  if (giftCode) {
    // Room was found above; the code pays as a payment would, which starts the server.
    let error: string | undefined;
    try {
      error = (await redeemGift(giftCode, user.id, server, { checkRoom: false })).error;
    } catch {
      error = "agentUnavailable";
    }
    if (error) {
      const applied = await db.server.count({ where: { id: server.id, status: { not: "AWAITING_PAYMENT" } } });
      if (!applied) {
        await db.server.delete({ where: { id: server.id } });
        return { error: (error in GIFT_FORM_ERRORS ? error : "agentUnavailable") as ServerErrorCode, values };
      }
    }
    (await cookies()).delete(GIFT_COOKIE);
    redirect(`/dashboard/servers/${server.id}?prezent=ok`);
  }

  if (paying) {
    let url: string;
    try {
      url = await checkoutUrl(user, server, plan, days, false, addons, creator?.creatorId, promoCode);
    } catch (err) {
      console.error("checkout failed", server.id, err);
      await db.server.delete({ where: { id: server.id } });
      return { error: "paymentsUnavailable", values };
    }
    redirect(url);
  }

  const busy = new Set<number>();
  for (let next = 1; ; next++) {
    try {
      await agent.createServer(agentSpec(server));
      break;
    } catch (err) {
      if (!agent.isFull(err)) console.error("create server failed", server.id, err);
      // Clean up anything half-created so the user can try again.
      await agent.deleteServer(server.id).catch(() => {});
      // Something on the machine holds the port (every new server would get it): take the next one.
      if (agent.portInUse(err) && server.port !== null && busy.size < 5) {
        busy.add(server.port);
        const moved = await changePort(server, busy);
        if (moved) {
          server = moved;
          next--;
          continue;
        }
      }
      // That machine has no free server's worth of memory awake right now: try the next one.
      if (agent.isFull(err) && next < candidates.length) {
        server = await db.server.update({ where: { id: server.id }, data: { node: candidates[next] } });
        agent.forgetServerNode(server.id);
        await syncPeerRoutes().catch((err) => console.error("peer routes not sent", err));
        continue;
      }
      await db.server.delete({ where: { id: server.id } });
      if (freeStarter) await giveBackFreeStarter(user.id);
      return { error: agent.isFull(err) ? "full" : "agentUnavailable", values };
    }
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
  // Its own machine may be full: then the whole plan has to fit on another, where it moves once paid for (moveIfFull).
  if (!(await canSellMemory(extraMb, planMb, server.node)) && !(await canSellMemory(planMb))) {
    return { error: "soldOut" };
  }

  let url: string;
  try {
    url = await checkoutUrl(
      user,
      server,
      parsed.data.plan,
      parsed.data.days,
      form.get("autoRenew") === "on",
      formAddons(form, parsed.data.plan, server.edition),
      // The first payment of a server made with a creator code, paid here after the first checkout was left.
      server.status === "AWAITING_PAYMENT" ? (server.creatorId ?? undefined) : undefined,
      // Likewise the Halloween code, while the event lasts (startCheckout checks).
      server.status === "AWAITING_PAYMENT" ? (server.promoCode ?? undefined) : undefined,
    );
  } catch (err) {
    console.error("checkout failed", server.id, err);
    return { error: "paymentsUnavailable" };
  }
  redirect(url);
}

const upgradeSchema = z.object({ plan: planField.exclude(["FREE"]) });

/** Moves a paid server to a bigger plan for the rest of its period, paying only the difference (upgrade.ts). */
export async function upgradeAction(id: string, _: CheckoutState, form: FormData): Promise<CheckoutState> {
  const user = await requireUser();
  const server = await getOwnedServer(id, user.id);
  if (!server) redirect("/dashboard");
  // Free, expired or unpaid: a whole period is bought on the billing page instead.
  if (!canUpgrade(server)) redirect(`/dashboard/servers/${server.id}/billing`);
  const parsed = upgradeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success || !biggerPlans(server.plan).some((p) => p.id === parsed.data.plan)) return { error: "invalidPlan" };
  if (form.get("startNow") !== "on") return { error: "consentRequired" };
  // As for a plan change: the extra memory here, or the whole plan on a machine it can move to.
  const planMb = planById(parsed.data.plan).ramGb * 1024;
  const extraMb = (await isAdmin(user.id)) ? 0 : planMb - heldMemoryMb(server);
  if (!(await canSellMemory(extraMb, planMb, server.node)) && !(await canSellMemory(planMb))) {
    return { error: "soldOut" };
  }

  const [{ locale, currency }, t] = await Promise.all([getPreferences(), getMessages()]);
  const { amount } = upgradeCost(server.plan, parsed.data.plan, server.paidUntil!, currency);
  let url: string;
  try {
    await db.user.updateMany({ where: { id: user.id }, data: { locale } });
    url = await startCheckout({
      user,
      server,
      plan: parsed.data.plan,
      days: 0,
      currency,
      locale,
      productName: format(t.upgrade.productName, { from: t.plans[server.plan], to: t.plans[parsed.data.plan], server: server.name }),
      startConsent: true,
      upgrade: { from: server.plan, amount },
      // The add-ons stay; only the plan's difference is paid.
      addons: serverAddons(server),
    });
  } catch (err) {
    console.error("upgrade checkout failed", server.id, err);
    return { error: "paymentsUnavailable" };
  }
  redirect(url);
}

/** Buys add-ons for the rest of the paid period, paying their share of the time left (addonCost in addons.ts). */
export async function buyAddonsAction(id: string, _: CheckoutState, form: FormData): Promise<CheckoutState> {
  const user = await requireUser();
  const server = await getOwnedServer(id, user.id);
  if (!server) redirect("/dashboard");
  if (!canBuyAddons(server)) redirect(`/dashboard/servers/${server.id}/billing`);
  const have = serverAddons(server);
  const added = formAddons(form, server.plan, server.edition).filter((a) => !have.includes(a));
  if (added.length === 0) return { error: "noAddons" };
  if (form.get("startNow") !== "on") return { error: "consentRequired" };

  const [{ locale, currency }, t] = await Promise.all([getPreferences(), getMessages()]);
  const { amount } = addonCost(added, server.paidUntil!, currency);
  let url: string;
  try {
    await db.user.updateMany({ where: { id: user.id }, data: { locale } });
    url = await startCheckout({
      user,
      server,
      plan: server.plan,
      days: 0,
      currency,
      locale,
      productName: format(t.paidAddons.productName, { list: added.map((a) => t.paidAddons.names[a]).join(", "), server: server.name }),
      startConsent: true,
      addons: [...have, ...added],
      addonsOnly: { amount },
    });
  } catch (err) {
    console.error("add-ons checkout failed", server.id, err);
    return { error: "paymentsUnavailable" };
  }
  redirect(url);
}

/** Drops an add-on now (what's paid isn't given back); the next payment no longer includes it. */
export async function removeAddonAction(id: string, addon: AddonId) {
  const user = await requireUser();
  const server = await getOwnedServer(id, user.id);
  if (!server || !server.addons.includes(addon)) return;
  await db.server.update({
    where: { id: server.id },
    data: {
      addons: server.addons.filter((a) => a !== addon),
      ...(addon === "domain" && { customDomain: null }),
      // The container keeps the backups count it was made with until it's rebuilt, on its next start.
      ...(addon === "backups" && server.status === "RUNNING" && { pluginsPending: true }),
    },
  });
  if (addon === "domain") await syncHostAliases().catch((err) => console.error("host aliases not sent", err));
  if (addon === "disk") await syncDiskLimits().catch((err) => console.error("disk limits not sent", err));
  revalidatePath(`/dashboard/servers/${id}/addons`);
}

/** Turns automatic renewal on (with the card already saved for this server) or off. */
export async function setAutoRenewAction(id: string, on: boolean) {
  const user = await requireUser();
  const server = await getOwnedServer(id, user.id);
  if (!server) return;
  // On needs a card; a server without one gets it by paying once with the box ticked.
  if (on && !server.renewCard) return;
  await db.server.update({ where: { id: server.id }, data: { autoRenew: on } });
  revalidatePath(`/dashboard/servers/${id}/billing`);
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
  // A plugin or mod taken off Modrinth, or needing one that was, would keep the server
  // down ("404 Not Found" in the console): it leaves the list and the server is rebuilt without it.
  const type = addonType(server);
  if (type === "plugin" || type === "mod") {
    const loader = type === "plugin" ? "paper" : server.kind;
    const gone = await uninstallableProjects(server.plugins.filter(isProjectId), loader, server.version === "LATEST" ? undefined : server.version);
    if (gone.length) {
      server.plugins = server.plugins.filter((p) => !gone.includes(p));
      server.pluginsPending = true;
      await db.server.update({ where: { id: server.id }, data: { plugins: server.plugins, pluginsPending: true } });
      console.log("dropped plugins Modrinth can no longer install", server.id, gone);
    }
  }
  try {
    // Plugins changed while it ran: rebuild it with the new list on the way up.
    if (server.pluginsPending) await agent.recreateServer(agentSpec(server));
    else
      await agent.startServer(server.id).catch(async (err) => {
        // Nothing on its machine (e.g. moved there before its container was built): build it now.
        if (!(err instanceof agent.AgentError && err.status === 404)) throw err;
        await agent.recreateServer(agentSpec(server));
      });
  } catch (err) {
    // A free server's machine is full right now: it moves to one with room and starts there.
    if (agent.isFull(err) && server.plan === "FREE" && (await startElsewhere(server).catch(() => null))) {
      await db.server.update({ where: { id: server.id }, data: { status: "RUNNING", pluginsPending: false } });
      revalidatePath(`/dashboard/servers/${id}`, "layout");
      return {};
    }
    if (agent.isFull(err)) return { error: "full" };
    if (agent.isDiskFull(err)) {
      revalidatePath(`/dashboard/servers/${id}`, "layout");
      return { error: "diskFull" };
    }
    throw err;
  }
  await db.server.update({ where: { id: server.id }, data: { status: "RUNNING", pluginsPending: false } });
  revalidatePath(`/dashboard/servers/${id}`, "layout");
  return {};
}

export async function stopServerAction(id: string) {
  const server = await serverOrThrow(id, "view");
  await agent.stopServer(server.id);
  await db.server.update({ where: { id: server.id }, data: { status: "STOPPED" } });
  revalidatePath(`/dashboard/servers/${id}`, "layout");
}

/** Stops the server and starts it again, e.g. after adding a plugin or when it lags. */
export async function restartServerAction(id: string): Promise<{ error?: ServerErrorCode }> {
  const server = await serverOrThrow(id, "view");
  if (server.status === "SUSPENDED" || server.status === "AWAITING_PAYMENT") return {};
  await agent.stopServer(server.id);
  return startServerAction(id);
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
  revalidatePath(`/dashboard/servers/${id}`, "layout");
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
  revalidatePath(`/dashboard/servers/${id}`, "layout");
  return {};
}

export type SettingsState = { error?: keyof Messages["settings"]["errors"]; player?: string };

const settingsSchema = z.object({
  version: z.string().optional(),
  gameMode: z.enum(GAME_MODES),
  difficulty: z.enum(DIFFICULTIES),
  motd: z.string().trim(),
  pvp: z.literal("on").optional(),
  maxPlayers: z.coerce.number().int().optional(),
  allowFlight: z.literal("on").optional(),
  hardcore: z.literal("on").optional(),
  commandBlocks: z.literal("on").optional(),
  allowNether: z.literal("on").optional(),
  forceGamemode: z.literal("on").optional(),
  spawnMonsters: z.literal("on").optional(),
  spawnProtection: z.coerce.number().int().min(0).max(SPAWN_PROTECTION_MAX).optional(),
  viewDistance: z.coerce.number().int().optional(),
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
  const limit = serverPlayerLimit(server, planById(server.plan));
  if (s.maxPlayers !== undefined && (s.maxPlayers < 1 || s.maxPlayers > limit)) return { error: "maxPlayersRange" };
  if (s.viewDistance !== undefined && (s.viewDistance < VIEW_DISTANCE_MIN || s.viewDistance > viewDistanceMax(server.plan))) return { error: "viewDistanceRange" };
  const players = parsePlayers(s.players);
  const bad = players.find((p) => !isValidPlayerName(server.edition, p));
  if (bad) return { error: "invalidPlayer", player: bad };
  if (players.length > WHITELIST_MAX) return { error: "tooManyPlayers" };
  const whitelist = s.whitelist === "on";
  if (whitelist && players.length === 0) return { error: "whitelistEmpty" };
  if (onHost(server) && (await worldTooNew(server, activeLevel(server), version))) return { error: "worldTooNew" };
  // CurseForge mods are pinned to a file for one Minecraft version: they're picked again for the new one.
  let plugins = server.plugins;
  let dropped: string[] = [];
  if (version !== server.version && isModLoader(server.kind)) {
    const repinned = await repinCurseforgeMods(server.plugins, version, server.kind);
    if (!repinned) return { error: "curseforgeUnavailable" };
    ({ plugins, dropped } = repinned);
  }

  const updated = await db.server.update({
    where: { id: server.id },
    data: {
      version,
      plugins,
      gameMode: s.gameMode,
      difficulty: s.difficulty,
      motd: s.motd,
      pvp: java ? s.pvp === "on" : server.pvp,
      // The plan's limit is kept as no pick, so a bigger plan raises it.
      maxPlayers: s.maxPlayers === undefined || s.maxPlayers === limit ? null : s.maxPlayers,
      allowFlight: java ? s.allowFlight === "on" : server.allowFlight,
      hardcore: java ? s.hardcore === "on" : server.hardcore,
      commandBlocks: java ? s.commandBlocks === "on" : server.commandBlocks,
      allowNether: java ? s.allowNether === "on" : server.allowNether,
      forceGamemode: java ? s.forceGamemode === "on" : server.forceGamemode,
      spawnMonsters: java ? s.spawnMonsters === "on" : server.spawnMonsters,
      spawnProtection: java ? (s.spawnProtection ?? server.spawnProtection) : server.spawnProtection,
      // The plan's default is kept as no pick, so changing plans moves it.
      viewDistance: !java || s.viewDistance === undefined ? server.viewDistance : s.viewDistance === viewDistanceDefault(server.plan) ? null : s.viewDistance,
      whitelist,
      whitelistPlayers: players,
      // On the version saved now: a mod server's login mod runs only on some.
      onlineMode: !(canRunNonPremium({ ...server, version }) && s.nonPremium === "on"),
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
  revalidatePath(`/dashboard/servers/${id}`, "layout");
  redirect(`/dashboard/servers/${id}?settings=saved${dropped.length ? `&dropped=${encodeURIComponent(dropped.join(", ").slice(0, 300))}` : ""}`);
}

export type IconState = { error?: "iconInvalid" | "applyFailed"; saved?: boolean };

/** Saves the picture in the server list (the browser already made it a 64×64 PNG). */
export async function saveIconAction(id: string, _: IconState, form: FormData): Promise<IconState> {
  const server = await serverOrThrow(id, "settings");
  const file = form.get("icon");
  if (server.edition !== "JAVA" || !(file instanceof Blob) || file.size > 64 * 1024) return { error: "iconInvalid" };
  const png = new Uint8Array(await file.arrayBuffer());
  // The PNG signature, then the image header's width and height.
  const view = new DataView(png.buffer);
  const isPng = png.length > 24 && [0x89, 0x50, 0x4e, 0x47].every((b, i) => png[i] === b);
  if (!isPng || view.getUint32(16) !== ICON_SIZE || view.getUint32(20) !== ICON_SIZE) return { error: "iconInvalid" };
  if (!canChangeFiles(server)) return { error: "applyFailed" };
  try {
    await agent.writeFile(server.id, "server-icon.png", new Blob([png]).stream(), png.length);
  } catch (err) {
    console.error("save icon failed", server.id, err);
    return { error: "applyFailed" };
  }
  return { saved: true };
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
  revalidatePath(`/dashboard/servers/${id}`, "layout");
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
