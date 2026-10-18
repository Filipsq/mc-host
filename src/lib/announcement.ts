import "server-only";
import { db } from "./db";
import * as agent from "./agent";

export const ANNOUNCEMENT_MAX = 300;

/** The notice shown above every page, or "" for none. Never breaks a page. */
export async function getAnnouncement() {
  try {
    return (await db.announcement.findUnique({ where: { id: 1 } }))?.text ?? "";
  } catch (err) {
    console.error("announcement: read failed", err);
    return "";
  }
}

export async function setAnnouncement(text: string) {
  await db.announcement.upsert({ where: { id: 1 }, create: { id: 1, text }, update: { text } });
}

/**
 * Says `text` in the chat of every server that's on right now (Java, Bedrock
 * and Terraria all take "say"). Returns how many got it; sleeping servers
 * refuse and are skipped.
 */
export async function sayOnAllServers(text: string) {
  const servers = await db.server.findMany({ where: { status: "RUNNING" }, select: { id: true } });
  const line = `say ${text.replace(/[\r\n]+/g, " ")}`;
  const results = await Promise.allSettled(servers.map((s) => agent.sendCommand(s.id, line)));
  return results.filter((r) => r.status === "fulfilled").length;
}
