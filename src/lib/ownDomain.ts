import "server-only";
import { Resolver } from "node:dns/promises";

// The "domain" add-on (addons.ts): the owner points their own domain at the
// server's Java address with a CNAME record, and the routers send players who
// type it to the server (agent/aliases.go). Before a domain is taken, its DNS
// must already lead here, so nobody claims a domain they don't control.

const GAME_DOMAIN = (process.env.GAME_DOMAIN ?? "localhost").toLowerCase();
// Like the agent's validHost, with at least one dot and a letter-only top level.
const DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export type OwnDomainError = "invalidDomain" | "ourDomain" | "dnsMissing" | "dnsWrong";

/** "https://Graj.MojSerwer.pl/" -> "graj.mojserwer.pl", as typed in the panel. */
export function cleanDomain(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/:].*$/, "")
    .replace(/\.$/, "");
}

export function checkDomainShape(domain: string): OwnDomainError | null {
  if (!DOMAIN.test(domain)) return "invalidDomain";
  if (domain === GAME_DOMAIN || domain.endsWith(`.${GAME_DOMAIN}`)) return "ourDomain";
  return null;
}

/**
 * Whether the domain already leads to `target` (the server's Java address): a
 * CNAME to it, or the same IPv4 addresses. Asks public DNS, as players' games do.
 */
export async function pointsAt(domain: string, target: string): Promise<OwnDomainError | null> {
  const dns = new Resolver({ timeout: 4000, tries: 2 });
  dns.setServers(["1.1.1.1", "9.9.9.9"]);
  const cname = await dns.resolveCname(domain).catch(() => [] as string[]);
  if (cname.some((c) => c.toLowerCase().replace(/\.$/, "") === target)) return null;
  const [mine, theirs] = await Promise.all([
    dns.resolve4(target).catch(() => [] as string[]),
    dns.resolve4(domain).catch(() => [] as string[]),
  ]);
  if (theirs.length === 0 && cname.length === 0) return "dnsMissing";
  return mine.length > 0 && theirs.length > 0 && theirs.every((ip) => mine.includes(ip)) ? null : "dnsWrong";
}
