import type { Server } from "@prisma/client";
import { canCrossplay } from "./plugins";

// Consoles (Xbox, PlayStation, Switch) can't type a server's address: they only
// join friends. A server can sign in an Xbox account of the owner's; players
// add it as a friend and join from the Friends tab (agent/xbox.go runs
// MCXboxBroadcast next to the server).

/** A server Bedrock players join: Bedrock itself, or Java with crossplay on. */
export function takesBedrockPlayers(server: Pick<Server, "edition" | "kind" | "crossplay">) {
  return server.edition === "BEDROCK" || (server.edition === "JAVA" && server.crossplay && canCrossplay(server));
}

/**
 * Whether the server may run the console sign-in: paid plans only, as it keeps
 * a small program (about 250 MB of memory) running next to the server all the time.
 */
export function xboxAllowed(server: Pick<Server, "edition" | "kind" | "crossplay" | "plan">) {
  return takesBedrockPlayers(server) && server.plan !== "FREE";
}

/** What the agent should run: the owner turned it on and the server may have it. */
export function xboxOn(server: Pick<Server, "edition" | "kind" | "crossplay" | "plan" | "xbox">) {
  return server.xbox && xboxAllowed(server);
}
