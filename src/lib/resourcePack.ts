import "server-only";
import { createHash } from "node:crypto";
import { lookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { AgentError, openFile } from "./agent";
export { PACK_PROMPT_MAX } from "./settings";

// A Java server's resource pack (texture pack). It isn't put in the server's
// files: the server gives players' games a link to the .zip and each game
// downloads it on joining. Before the link is saved the site downloads it once
// to check it really is a zip (not a Dropbox or Google Drive page) and to work
// out its SHA-1, which lets games keep a copy until the pack changes.
//
// An owner without a link can upload the .zip instead: it's kept in the
// server's own files (PACK_FILE, counted in its disk space) and our site hands
// it to games at /rp/<server>/<sha1>.zip (src/app/rp/[id]/[file]/route.ts).

export const PACK_MAX_BYTES = 250 * 1024 * 1024; // what Minecraft accepts since 1.18
const TIMEOUT_MS = 90_000;
const MAX_REDIRECTS = 5;

export type PackError = "invalidUrl" | "unreachable" | "notZip" | "tooBig" | "noFile";

/** Where an uploaded pack is kept in the server's files. */
export const PACK_FILE = ".resourcepack/pack.zip";

const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";

/** The address games download an uploaded pack from; the SHA-1 in it changes with every new pack. */
export const uploadedPackUrl = (serverId: string, sha1: string) => `${appUrl()}/rp/${serverId}/${sha1}.zip`;

/** Whether the saved pack is one uploaded to us rather than a link elsewhere. */
export const isUploadedPack = (url: string | null | undefined) => !!url && url.startsWith(`${appUrl()}/rp/`);

/** Checks the uploaded pack in the server's files: its SHA-1 if it's a zip of an allowed size. */
export async function checkUploadedPack(serverId: string): Promise<{ sha1: string } | { error: PackError }> {
  let res: Response;
  try {
    res = await openFile(serverId, PACK_FILE, { max: PACK_MAX_BYTES, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    if (err instanceof AgentError && err.status === 413) return { error: "tooBig" };
    if (err instanceof AgentError && err.status === 404) return { error: "noFile" };
    console.error("read uploaded resource pack failed", serverId, err);
    return { error: "unreachable" };
  }
  if (!res.body) return { error: "noFile" };
  return hashZip(Readable.fromWeb(res.body as never));
}

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
    return hashZip(res);
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

/** The SHA-1 of a zip read chunk by chunk; stops reading once it's too big. */
async function hashZip(chunks: Readable): Promise<{ sha1: string } | { error: PackError }> {
  const hash = createHash("sha1");
  let size = 0;
  let head = Buffer.alloc(0);
  try {
    for await (const chunk of chunks as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > PACK_MAX_BYTES) {
        chunks.destroy();
        return { error: "tooBig" };
      }
      if (head.length < 4) head = Buffer.concat([head, chunk.subarray(0, 4 - head.length)]);
      hash.update(chunk);
    }
  } catch {
    return { error: "unreachable" };
  }
  // Every zip starts with "PK\3\4"; a web page doesn't.
  if (head.length < 4 || head.readUInt32BE(0) !== 0x504b0304) return { error: "notZip" };
  return { sha1: hash.digest("hex") };
}
