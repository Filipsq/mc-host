import type { Plan } from "@prisma/client";
import { plans } from "./plans";
import { planFor, ramNeeded, type PlayerGroup, type RamUse } from "./ram";
import { planAtLeast } from "./modpacks";
import { TMOD_MIN_PLAN, type TerrariaKind } from "./terraria";
import type { GameId } from "./games";
import { addonList, type AddonId } from "./addons";

// "Pomóż mi zdecydować" on the new server page: a few questions (what people
// play on, how many at once, mods or not, what else matters), then the plan
// and game to start from. Built on the RAM calculator's numbers (ram.ts).

export const HELPER_PLATFORMS = ["java", "bedrock", "both", "terraria"] as const;
export type HelperPlatform = (typeof HELPER_PLATFORMS)[number];

/** What the server runs: the calculator's choices for Minecraft, the server type for Terraria. */
export type HelperContent = RamUse | TerrariaKind;
export const MINECRAFT_CONTENT = ["vanilla", "plugins", "mods", "bigmods"] as const satisfies readonly RamUse[];
export const TERRARIA_CONTENT = ["vanilla", "tshock", "tmodloader"] as const satisfies readonly TerrariaKind[];

export const HELPER_EXTRAS = ["alwaysOn", "backups", "nonPremium"] as const;
export type HelperExtra = (typeof HELPER_EXTRAS)[number];

export type HelperAnswers = {
  platform: HelperPlatform;
  players: PlayerGroup;
  content: HelperContent;
  extras: HelperExtra[];
  addons: AddonId[]; // paid add-ons (addons.ts)
};

/** Why the plan came out as it did, one line each in the helper. */
export type HelperReason =
  | { code: "players"; plan: Plan; max: number | null }
  | { code: "ram"; plan: Plan; gb: number; planGb: number }
  | { code: "free" }
  | { code: "alwaysOn" }
  | { code: "backups"; plan: Plan; kept: number }
  | { code: "freeTaken" }
  | { code: "modsPaid" }
  | { code: "bigPacks" }
  | { code: "tooBig" }
  | { code: "noCrossplay" }
  | { code: "noNonPremium" }
  | { code: "addonsPaid" }
  | { code: "group"; plan: Plan };

export type HelperPick = {
  plan: Plan;
  edition: "JAVA" | "BEDROCK" | "TERRARIA";
  game?: GameId; // Java only
  terrariaKind?: TerrariaKind;
  crossplay: boolean;
  nonPremium: boolean;
  addons: AddonId[];
  reasons: HelperReason[];
};

// From a group of 6 or more players at once, at least Standard, so the
// server doesn't lag with everyone on (Fiq's call, 2026-10-21).
const GROUP_PLAYERS = 10; // the "6–10" answer
const GROUP_PLAN: Plan = "STANDARD";

const maxPlan = (a: Plan, b: Plan) => (planAtLeast(a, b) ? a : b);

/** Which content answers make sense on a platform; Bedrock has no plugins or mods here. */
export function contentFor(platform: HelperPlatform): readonly HelperContent[] {
  return platform === "terraria" ? TERRARIA_CONTENT : platform === "bedrock" ? [] : MINECRAFT_CONTENT;
}

/** The plan and game to start from. `freeTaken`: the player already has their free server. */
export function recommend(a: HelperAnswers, freeTaken: boolean): HelperPick {
  const terraria = a.platform === "terraria";
  const content = contentFor(a.platform).includes(a.content) ? a.content : contentFor(a.platform)[0] ?? "vanilla";
  // Terraria runs on the same plans; tModLoader is about as heavy as a light mod pack.
  const use: RamUse = terraria ? (content === "tmodloader" ? "mods" : "vanilla") : (content as RamUse);
  const modded = use === "mods" || use === "bigmods";
  const reasons: HelperReason[] = [];

  const fits = planFor(use, a.players);
  let plan: Plan = fits ?? "PRO";
  if (!fits) reasons.push({ code: "tooBig" });
  else if (a.players >= GROUP_PLAYERS && !planAtLeast(fits, GROUP_PLAN)) {
    plan = GROUP_PLAN;
    reasons.push({ code: "group", plan });
  } else if (plan === "FREE") reasons.push({ code: "free" });
  else {
    const spec = plans.find((p) => p.id === plan)!;
    // Say whichever made the plan this big: the players or the memory.
    const forPlayers = plans.find((p) => p.maxPlayers === null || p.maxPlayers >= a.players)!.id;
    if (forPlayers === plan) reasons.push({ code: "players", plan, max: spec.maxPlayers });
    else reasons.push({ code: "ram", plan, gb: ramNeeded(use, a.players), planGb: spec.ramGb });
  }
  if (modded && !terraria) {
    reasons.push({ code: "modsPaid" });
    if (use === "bigmods" && plan !== "PRO") reasons.push({ code: "bigPacks" });
  }
  if (terraria && content === "tmodloader") plan = maxPlan(plan, TMOD_MIN_PLAN);

  const extras = new Set(a.extras);
  if (extras.has("alwaysOn") && plan === "FREE") reasons.push({ code: "alwaysOn" });
  if (extras.has("alwaysOn")) plan = maxPlan(plan, "STARTER");
  if (extras.has("backups")) {
    plan = maxPlan(plan, "STARTER");
    reasons.push({ code: "backups", plan, kept: plans.find((p) => p.id === plan)!.backupsKept });
  }
  // The own domain is for Java addresses only.
  const addons = addonList(a.addons).filter((x) => x !== "domain" || (a.platform !== "bedrock" && !terraria));
  if (addons.length > 0 && plan === "FREE") {
    plan = "STARTER";
    reasons.push({ code: "addonsPaid" });
  }
  if (freeTaken && plan === "FREE") {
    plan = "STARTER";
    reasons.push({ code: "freeTaken" });
  }
  // The "free plan is enough" line no longer holds once something above moved the plan up.
  const final = plan;
  const out = reasons.filter((r) => r.code !== "free" || final === "FREE");

  if (terraria) {
    return { plan, edition: "TERRARIA", terrariaKind: content as TerrariaKind, crossplay: false, nonPremium: false, addons, reasons: out };
  }
  if (a.platform === "bedrock") {
    return { plan, edition: "BEDROCK", crossplay: false, nonPremium: false, addons, reasons: out };
  }
  // Crossplay comes through plugins, so only on servers without mods. Non-premium
  // needs a login mod on a pack, which only some loaders and versions have.
  const crossplay = a.platform === "both" && !modded;
  const nonPremium = extras.has("nonPremium");
  if (a.platform === "both" && modded) out.push({ code: "noCrossplay" });
  if (extras.has("nonPremium") && modded) out.push({ code: "noNonPremium" });
  const game: GameId = modded ? "modpack" : use === "plugins" ? "survival-plus" : "survival";
  return { plan, edition: "JAVA", game, crossplay, nonPremium, addons, reasons: out };
}
