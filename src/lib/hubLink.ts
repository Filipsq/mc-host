import { generateKeyPairSync } from "node:crypto";
import type { Server } from "@prisma/client";
import { supportsPlugins } from "./plugins";

// Połączenie z hubem: the mchosting-link plugin (Filipsq/mc-server, module link) on an owner's
// Paper server. Its players type /hub and land in the mchosting.pl network's hub through
// Minecraft's transfer; in the hub, /wroc sends them back here.
//
// Before /hub the plugin stores a "return ticket" in the player's game (a cookie), signed with
// this server's own Ed25519 key. The hub reads it, asks /api/link/servers/<id> for this server's
// address and public key, and only then offers the way back. The address never comes from the
// cookie, so nobody can make the hub send players to a server of their choosing; an owner who
// reads the private key in their files can only sign tickets back to their own server.

/** Where /hub sends players. */
export const HUB_HOST = process.env.HUB_HOST ?? "hub.mchosting.pl";
export const HUB_PORT = Number(process.env.HUB_PORT ?? 25565);

/**
 * Paper (or a game mode on it) on Minecraft 1.20.6 or newer: the plugin needs transfer and cookies
 * (1.20.5) and Paper's Brigadier commands (1.20.6).
 */
export function canHubLink(s: Pick<Server, "edition" | "kind" | "version">) {
  if (!supportsPlugins(s)) return false;
  const m = s.version.match(/^1\.(\d+)(?:\.(\d+))?$/);
  if (!m) return true; // LATEST, 26.x and on
  const minor = Number(m[1]);
  return minor > 20 || (minor === 20 && Number(m[2] ?? 0) >= 6);
}

/** Whether the hub link runs on this server now. */
export const hubLinkOn = (s: Pick<Server, "edition" | "kind" | "version" | "hubLink" | "hubLinkPrivateKey">) =>
  s.hubLink && !!s.hubLinkPrivateKey && canHubLink(s);

/** A new key pair, base64 DER (PKCS#8 private, SPKI public), as the plugin and the hub read them. */
export function hubLinkKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });
  return { hubLinkPublicKey: publicKey.toString("base64"), hubLinkPrivateKey: privateKey.toString("base64") };
}

/** What the agent writes into the plugin's config.yml (agent/hublink.go); none when it's off. */
export function hubLinkSpec(s: Server) {
  if (!hubLinkOn(s)) return undefined;
  return { serverId: s.id, privateKey: s.hubLinkPrivateKey!, hubHost: HUB_HOST, hubPort: HUB_PORT };
}
