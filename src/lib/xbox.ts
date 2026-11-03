import type { Server } from "@prisma/client";
import type { Currency } from "@/i18n/config";
import { canCrossplay } from "./plugins";
import { ADDON_SPECS, serverAddons } from "./addons";

// Consoles (Xbox, PlayStation, Switch) can't type a server's address: they only
// join friends. A server can sign in an Xbox account of the owner's; players
// add it as a friend and join from the Friends tab (agent/xbox.go runs
// MCXboxBroadcast next to the server).
//
// It costs us memory on the machine all the time, so it's paid for: on a paid
// plan it's the "xbox" add-on (addons.ts), and a free server buys it on its own
// for XBOX_DAYS at a time, dearer.

export const XBOX_DAYS = 30;

/** What XBOX_DAYS of console joining cost a free server, like the plans' prices. */
export const XBOX_PRICE: Record<Currency, number> = { PLN: 9.99, EUR: 2.49, USD: 2.69, GBP: 2.19 };

/** A server Bedrock players join: Bedrock itself, or Java with crossplay on. */
export function takesBedrockPlayers(server: Pick<Server, "edition" | "kind" | "crossplay">) {
  return server.edition === "BEDROCK" || (server.edition === "JAVA" && server.crossplay && canCrossplay(server));
}

/** The add-on's 30-day price on a paid plan, to show free servers what they'd save. */
export const XBOX_ADDON_PRICE = ADDON_SPECS.xbox.price;

type XboxServer = Pick<Server, "edition" | "kind" | "crossplay" | "plan" | "xboxUntil" | "addons">;

/** Whether a free server's bought days are still running. */
export const xboxPaidFor = (server: Pick<Server, "xboxUntil">, now = new Date()) => !!server.xboxUntil && server.xboxUntil > now;

/** Whether the server paid for console joining: the add-on on a paid plan, or bought days on a free one. */
export function xboxPaid(server: Pick<Server, "plan" | "addons" | "xboxUntil">, now = new Date()) {
  return server.plan === "FREE" ? xboxPaidFor(server, now) : serverAddons(server).includes("xbox");
}

/** Whether the server may run the console sign-in. */
export function xboxAllowed(server: XboxServer, now = new Date()) {
  return takesBedrockPlayers(server) && xboxPaid(server, now);
}

/** What the agent should run: the owner turned it on and the server may have it. */
export function xboxOn(server: XboxServer & Pick<Server, "xbox">, now = new Date()) {
  return server.xbox && xboxAllowed(server, now);
}

/** Where the bought days end once `days` more are paid for, counting from what's left. */
export function xboxUntilAfter(server: Pick<Server, "xboxUntil">, days: number, now = new Date()) {
  const from = xboxPaidFor(server, now) ? server.xboxUntil! : now;
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}
