import "server-only";
import { after } from "next/server";
import { Prisma, type Server } from "@prisma/client";
import { db } from "./db";
import { isAdmin } from "./admin";
import { messages, format } from "@/i18n/messages";
import { defaultLocale, isLocale } from "@/i18n/config";
import { BRAND_NAME } from "./brand";
import { buttonMail, sendMail } from "./mail";
import { siteUrl } from "./site";

// Who may open a server's panel: its owner, the admins, and friends the owner
// let in. A friend always sees the server and may start and stop it; anything
// more is a permission the owner ticks. Paying, deleting the server and
// letting others in stay with the owner.

export const SERVER_PERMS = ["console", "files", "plugins", "settings", "backups"] as const;
export type ServerPerm = (typeof SERVER_PERMS)[number];
export const isPerm = (p: unknown): p is ServerPerm => SERVER_PERMS.includes(p as ServerPerm);

/** What a page or action needs: just seeing the server, the owner's rights, or one permission. */
export type ServerNeed = "view" | "owner" | ServerPerm;

export type ServerAccess = { server: Server; role: "owner" | "admin" | "friend"; perms: ServerPerm[] };

/** Most friends one server may have. */
export const MEMBERS_MAX = 10;
/** Invitations one owner may send per day, so the form can't be used to send mail at will. */
export const INVITES_PER_DAY = 20;

export async function getServerAccess(id: string, userId: string): Promise<ServerAccess | null> {
  const found = await db.server.findUnique({
    where: { id },
    include: { members: { where: { userId }, select: { perms: true } } },
  });
  if (!found) return null;
  const { members, ...server } = found;
  if (server.ownerId === userId) return { server, role: "owner", perms: [...SERVER_PERMS] };
  // Admins get every server, to help their owners.
  if (await isAdmin(userId)) return { server, role: "admin", perms: [...SERVER_PERMS] };
  if (members[0]) return { server, role: "friend", perms: members[0].perms.filter(isPerm) };
  return null;
}

export function allows(access: Pick<ServerAccess, "role" | "perms">, need: ServerNeed) {
  if (need === "view" || access.role !== "friend") return true;
  return need !== "owner" && access.perms.includes(need);
}

/** The server, if the user may do what's needed with it; null otherwise, so IDs in URLs can't reach others' servers. */
export async function getServerFor(id: string, userId: string, need: ServerNeed) {
  const access = await getServerAccess(id, userId);
  return access && allows(access, need) ? access.server : null;
}

/** Servers the user was let into, with whose they are. */
export function sharedServers(userId: string) {
  return db.server.findMany({
    where: { members: { some: { userId } } },
    include: { owner: { select: { email: true } } },
    orderBy: { createdAt: "desc" },
  });
}

/** Gives a new account the servers its email was invited to before it existed. */
export async function linkInvites(userId: string, email: string) {
  await db.serverMember.updateMany({ where: { email, userId: null }, data: { userId } });
}

export type InviteError = "invalidEmail" | "self" | "already" | "tooMany" | "tooManyToday";

/**
 * Lets the person with this email into the server and tells them by email.
 * It works the same whether or not they have an account yet, so the form
 * doesn't reveal who has one; a new account picks the invitation up.
 */
export async function inviteFriend(
  server: Pick<Server, "id" | "name" | "ownerId">,
  email: string,
  perms: ServerPerm[],
  fallbackLocale: string,
): Promise<InviteError | null> {
  const owner = await db.user.findUnique({ where: { id: server.ownerId }, select: { email: true } });
  if (!owner) return "invalidEmail";
  if (email === owner.email) return "self";
  const [count, today, user] = await Promise.all([
    db.serverMember.count({ where: { serverId: server.id } }),
    db.serverMember.count({
      where: { server: { ownerId: server.ownerId }, createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    }),
    db.user.findUnique({ where: { email }, select: { id: true, locale: true } }),
  ]);
  if (count >= MEMBERS_MAX) return "tooMany";
  if (today >= INVITES_PER_DAY) return "tooManyToday";
  try {
    await db.serverMember.create({ data: { serverId: server.id, email, userId: user?.id, perms } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return "already";
    throw err;
  }
  after(() => sendInvite(server, owner.email, email, user, fallbackLocale));
  return null;
}

async function sendInvite(
  server: Pick<Server, "id" | "name">,
  ownerEmail: string,
  to: string,
  user: { locale: string } | null,
  fallbackLocale: string,
) {
  const locale = user && isLocale(user.locale) ? user.locale : isLocale(fallbackLocale) ? fallbackLocale : defaultLocale;
  const all = messages[locale];
  const t = all.access.mail;
  const vars = { owner: ownerEmail, server: server.name, brand: BRAND_NAME, email: to };
  const app = siteUrl();
  const mail = buttonMail({
    to,
    subject: format(t.subject, vars),
    paragraphs: [format(t.intro, vars), format(user ? t.hasAccount : t.noAccount, vars)],
    button: user ? t.open : t.signUp,
    url: user ? `${app}/dashboard/servers/${server.id}` : `${app}/signup`,
    footer: format(all.planMail.footer, { brand: BRAND_NAME, contact: `${app}/kontakt` }),
  });
  try {
    await sendMail(mail);
  } catch (err) {
    console.error(`[mail] invitation to server ${server.id} failed:`, err);
  }
}
