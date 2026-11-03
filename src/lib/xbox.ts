import type { Server } from "@prisma/client";
import type { Currency } from "@/i18n/config";
import { canCrossplay } from "./plugins";

// Consoles (Xbox, PlayStation, Switch) can't type a server's address: they only
// join friends. A server can sign in an Xbox account of the owner's; players
// add it as a friend and join from the Friends tab (agent/xbox.go runs
// MCXboxBroadcast next to the server).
//
// It costs us memory on the machine all the time, so a paid plan has it
// included, while a free server buys it on its own for XBOX_DAYS at a time.

export const XBOX_DAYS = 30;

/** What XBOX_DAYS of console joining cost a free server, like the plans' prices. */
export const XBOX_PRICE: Record<Currency, number> = { PLN: 9.99, EUR: 2.49, USD: 2.69, GBP: 2.19 };

/** A server Bedrock players join: Bedrock itself, or Java with crossplay on. */
export function takesBedrockPlayers(server: Pick<Server, "edition" | "kind" | "crossplay">) {
  return server.edition === "BEDROCK" || (server.edition === "JAVA" && server.crossplay && canCrossplay(server));
}

type XboxServer = Pick<Server, "edition" | "kind" | "crossplay" | "plan" | "xboxUntil">;

/** Whether a free server's bought days are still running. */
export const xboxPaidFor = (server: Pick<Server, "xboxUntil">, now = new Date()) => !!server.xboxUntil && server.xboxUntil > now;

/** Whether the server may run the console sign-in: a paid plan, or a free one that paid for it. */
export function xboxAllowed(server: XboxServer, now = new Date()) {
  return takesBedrockPlayers(server) && (server.plan !== "FREE" || xboxPaidFor(server, now));
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
