import "server-only";
import type { Server } from "@prisma/client";
import { db } from "./db";
import { readLogTail } from "./agent";
import { getLiveDetails } from "./servers";
import { getPluginInfos } from "./modrinth";
import { curseforgeMod, isProjectId, sitePlugin } from "./plugins";
import { BRAND_NAME } from "./brand";

// "Kopiuj dla Claude" (Fiq asked 2026-11-14): one click on an admin's chat with a
// customer or on a server copies everything Claude needs to help (the server's
// facts, live state, plugins, console and the chat) as text, so Fiq pastes it into
// his Claude project instead of copying each part from the panel by hand.

const ANSI = /\u001b?\[[0-9;]*m/g;
const CHAT_MESSAGES = 20;
const CONSOLE_LINES = 150;

type ServerFacts = Pick<
  Server,
  "id" | "name" | "edition" | "kind" | "version" | "plan" | "status" | "node" | "plugins" | "onlineMode" | "crossplay" | "modpackTitle" | "modpackVersion" | "paidUntil" | "memoryMb" | "subdomain" | "port"
>;
const SERVER_FIELDS = {
  id: true,
  name: true,
  edition: true,
  kind: true,
  version: true,
  plan: true,
  status: true,
  node: true,
  plugins: true,
  onlineMode: true,
  crossplay: true,
  modpackTitle: true,
  modpackVersion: true,
  paidUntil: true,
  memoryMb: true,
  subdomain: true,
  port: true,
} as const;

const day = (d: Date) => d.toISOString().slice(0, 10);
const time = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ") + " UTC";

/** One server as text: what it is, its state right now and the owner's plugins or mods by name. */
async function describeServer(s: ServerFacts) {
  const live = await getLiveDetails(s).catch(() => null);
  const names = await getPluginInfos(s.plugins.filter(isProjectId));
  const plugins = s.plugins.map((p) => {
    if (curseforgeMod(p)) return `${p} (CurseForge)`;
    if (sitePlugin(p)) return p;
    const info = names.get(p);
    return info ? `${info.title} (${p})` : p;
  });
  const agent = live?.agent;
  return [
    `Serwer „${s.name}” (id ${s.id})`,
    `- ${s.edition}, typ ${s.kind}${s.modpackTitle ? ` (${s.modpackTitle}${s.modpackVersion ? ` ${s.modpackVersion}` : ""})` : ""}, wersja ${s.version}`,
    `- plan ${s.plan}, ${s.memoryMb} MB RAM, maszyna ${s.node}${s.plan !== "FREE" && s.paidUntil ? `, opłacony do ${day(s.paidUntil)}` : ""}`,
    `- status w bazie ${s.status}, stan teraz: ${live?.live ?? "nie wiadomo (agent nie odpowiedział)"}${agent ? ` (kontener ${agent.state}, exitCode ${agent.exitCode}, restarty ${agent.restartCount}${agent.stopReason ? `, powód ${agent.stopReason}` : ""}${agent.startedAt ? `, start ${agent.startedAt}` : ""})` : ""}`,
    `- adres ${s.subdomain ? `${s.subdomain}.mchosting.pl` : "–"}${s.port ? `, port ${s.port}` : ""}; non-premium ${s.onlineMode ? "wył." : "wł."}, crossplay ${s.crossplay ? "wł." : "wył."}`,
    `- pluginy/mody właściciela: ${plugins.length ? plugins.join(", ") : "brak"}`,
  ].join("\n");
}

async function consoleBlock(s: Pick<Server, "id" | "name">) {
  const lines = await readLogTail(s.id).catch(() => null);
  if (!lines) return `Konsola „${s.name}”: nie udało się odczytać.`;
  const text = lines.slice(-CONSOLE_LINES).map((l) => l.replace(ANSI, "")).join("\n");
  return `Konsola „${s.name}” (ostatnie ${Math.min(lines.length, CONSOLE_LINES)} linii):\n\`\`\`\n${text || "(pusta)"}\n\`\`\``;
}

async function chatLines(userId: string, take: number) {
  const recent = await db.supportMessage.findMany({
    where: { chatId: userId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take,
    select: { fromStaff: true, body: true, createdAt: true, log: true, logServer: true, image: { select: { id: true } } },
  });
  return recent.reverse();
}

const chatText = (messages: Awaited<ReturnType<typeof chatLines>>) =>
  messages
    .map((m) => `[${time(m.createdAt)}] ${m.fromStaff ? "Admin" : "Klient"}: ${m.body}${m.image ? " [wysłał zdjęcie]" : ""}${m.log ? ` [dołączył konsolę serwera ${m.logServer}]` : ""}`)
    .join("\n");

/** The text for a customer's chat: who they are, their servers (consoles of those that are down) and the chat. */
export async function chatContextText(userId: string): Promise<string | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { email: true, locale: true, createdAt: true, servers: { orderBy: { createdAt: "desc" }, take: 6, select: SERVER_FIELDS } },
  });
  if (!user) return null;
  const [servers, messages] = await Promise.all([Promise.all(user.servers.map(describeServer)), chatLines(userId, CHAT_MESSAGES)]);
  // Most chats are about a server that won't start, so the consoles of those that are down or starting go too.
  const down: ServerFacts[] = [];
  for (const s of user.servers) {
    if (down.length >= 2) break;
    const d = await getLiveDetails(s).catch(() => null);
    if (d && ["crashed", "starting", "restarting"].includes(d.live)) down.push(s);
  }
  const consoles = await Promise.all(down.map(consoleBlock));
  const sentLog = [...messages].reverse().find((m) => m.log && !m.fromStaff);
  return [
    `Pomóż mi odpisać klientowi na czacie pomocy ${BRAND_NAME}. Dane z panelu (${time(new Date())}):`,
    `Klient: ${user.email}, konto od ${day(user.createdAt)}, język ${user.locale}.`,
    servers.length ? servers.join("\n\n") : "Klient nie ma jeszcze serwerów.",
    ...consoles,
    sentLog?.log ? `Konsola, którą klient wysłał na czacie (serwer ${sentLog.logServer}):\n\`\`\`\n${sentLog.log.split("\n").slice(-CONSOLE_LINES).join("\n")}\n\`\`\`` : "",
    `Czat (od najstarszej, ostatnie ${messages.length} wiadomości):\n${chatText(messages) || "(pusty)"}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The text for one server: facts, state, plugins, console and the owner's chat of the last 3 days. */
export async function serverContextText(serverId: string): Promise<string | null> {
  const server = await db.server.findUnique({ where: { id: serverId }, select: { ...SERVER_FIELDS, owner: { select: { id: true, email: true, locale: true } } } });
  if (!server) return null;
  const since = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const [facts, log, messages] = await Promise.all([
    describeServer(server),
    consoleBlock(server),
    chatLines(server.owner.id, 10).then((list) => list.filter((m) => m.createdAt >= since)),
  ]);
  return [
    `Co się dzieje z tym serwerem na ${BRAND_NAME} i jak to naprawić? Dane z panelu (${time(new Date())}):`,
    `Właściciel: ${server.owner.email}, język ${server.owner.locale}.`,
    facts,
    log,
    messages.length ? `Czat właściciela z ostatnich 3 dni:\n${chatText(messages)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
