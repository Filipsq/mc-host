import Link from "next/link";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { getMessages } from "@/i18n/server";
import { format } from "@/i18n/messages";

// An admin opening someone else's server sees whose it is on every page of its panel.
export default async function ServerLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const [session, { id }] = await Promise.all([getSession(), params]);
  const server = session?.user?.id
    ? await db.server.findUnique({ where: { id }, select: { ownerId: true, owner: { select: { email: true } } } })
    : null;
  // The pages themselves decide who may see the server; this only labels it.
  if (!server || server.ownerId === session?.user?.id) return children;
  const t = (await getMessages()).admin;
  return (
    <>
      <div className="admin-banner">
        <p className="notice warn">
          {format(t.viewing, { email: server.owner.email })} <Link href={`/admin/servers/${id}`}>{t.openAdmin}</Link>
        </p>
      </div>
      {children}
    </>
  );
}
