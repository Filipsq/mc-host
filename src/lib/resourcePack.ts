import "server-only";
import { createHash } from "node:crypto";
import { lookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
export { PACK_PROMPT_MAX } from "./settings";

// A Java server's resource pack (texture pack). It isn't put in the server's
// files: the server gives players' games a link to the .zip and each game
// downloads it on joining. Before the link is saved the site downloads it once
// to check it really is a zip (not a Dropbox or Google Drive page) and to work
// out its SHA-1, which lets games keep a copy until the pack changes.

export const PACK_MAX_BYTES = 250 * 1024 * 1024; // what Minecraft accepts since 1.18
const TIMEOUT_MS = 90_000;
const MAX_REDIRECTS = 5;

export type PackError = "invalidUrl" | "unreachable" | "notZip" | "tooBig";

/** Turns a share link into the direct download link games need, where we know how. */
export function directPackUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return input.trim();
  }
  const host = url.hostname.toLowerCase();
  // Dropbox: dl=0 opens a preview page, dl=1 sends the file.
  if (host === "dropbox.com" || host.endsWith(".dropbox.com")) {
    url.searchParams.delete("raw");
    url.searchParams.set("dl", "1");
  }
  // Google Drive: /file/d/<id>/view is a page; this asks for the file.
  const drive = host === "drive.google.com" && url.pathname.match(/^\/file\/d\/([\w-]+)/);
  if (drive) return `https://drive.usercontent.google.com/download?id=${drive[1]}&export=download&confirm=t`;
  return url.toString();
}

// Addresses on the internet only: the check mustn't reach our own machines.
const PRIVATE = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3],
] as const) PRIVATE.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [["::", 127], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["::ffff:0:0", 96]] as const) PRIVATE.addSubnet(net, bits, "ipv6");
const isPublic = (ip: string) => isIP(ip) !== 0 && !PRIVATE.check(ip, isIP(ip) === 6 ? "ipv6" : "ipv4");

const publicLookup: LookupFunction = (hostname, options, callback) =>
  lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const ok = addresses.filter((a) => isPublic(a.address));
    if (ok.length === 0) return callback(Object.assign(new Error("not a public address"), { code: "ENOTFOUND" }), "", 4);
    if (options.all) return (callback as unknown as (e: null, a: typeof ok) => void)(null, ok);
    callback(null, ok[0].address, ok[0].family);
  });

/** Downloads the pack once: its SHA-1 if it's a zip of an allowed size. */
export async function checkPack(link: string): Promise<{ sha1: string } | { error: PackError }> {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return { error: "invalidUrl" };
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || link.length > 1000 || /\s/.test(link)) return { error: "invalidUrl" };
  if (isIP(url.hostname.replace(/^\[|\]$/g, "")) && !isPublic(url.hostname.replace(/^\[|\]$/g, ""))) return { error: "invalidUrl" };

  const deadline = AbortSignal.timeout(TIMEOUT_MS);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await get(url, deadline).catch(() => null);
    if (!res) return { error: "unreachable" };
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      try {
        url = new URL(res.headers.location, url);
      } catch {
        return { error: "unreachable" };
      }
      if (url.protocol !== "https:" && url.protocol !== "http:") return { error: "unreachable" };
      continue;
    }
    if (status !== 200) {
      res.resume();
      return { error: "unreachable" };
    }
    if (Number(res.headers["content-length"] ?? 0) > PACK_MAX_BYTES) {
      res.destroy();
      return { error: "tooBig" };
    }
    return readZip(res);
  }
  return { error: "unreachable" };
}

function get(url: URL, signal: AbortSignal): Promise<http.IncomingMessage> {
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.get(url, { lookup: publicLookup, signal, headers: { "user-agent": "mchosting-resource-pack-check" } }, resolve);
    req.on("error", reject);
  });
}

function readZip(res: http.IncomingMessage): Promise<{ sha1: string } | { error: PackError }> {
  return new Promise((resolve) => {
    const hash = createHash("sha1");
    let size = 0;
    let head = Buffer.alloc(0);
    res.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > PACK_MAX_BYTES) {
        res.destroy();
        return resolve({ error: "tooBig" });
      }
      if (head.length < 4) head = Buffer.concat([head, chunk.subarray(0, 4 - head.length)]);
      hash.update(chunk);
    });
    res.on("error", () => resolve({ error: "unreachable" }));
    res.on("end", () => {
      // Every zip starts with "PK\3\4"; a web page doesn't.
      if (head.length < 4 || head.readUInt32BE(0) !== 0x504b0304) return resolve({ error: "notZip" });
      resolve({ sha1: hash.digest("hex") });
    });
  });
}
