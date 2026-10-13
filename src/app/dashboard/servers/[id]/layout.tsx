import Link from "next/link";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { isAdmin } from "@/lib/admin";
import { getMessages } from "@/i18n/server";
import { format } from "@/i18n/messages";
import LeaveButton from "./LeaveButton";

// Someone opening another person's server sees whose it is on every page of
// its panel: a friend the owner let in, or an admin helping.
export default async function ServerLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const [session, { id }] = await Promise.all([getSession(), params]);
  const userId = session?.user?.id;
  const server = userId
    ? await db.server.findUnique({
        where: { id },
        select: { ownerId: true, owner: { select: { email: true } }, members: { where: { userId }, select: { id: true } } },
      })
    : null;
  // The pages themselves decide who may see the server; this only labels it.
  if (!userId || !server || server.ownerId === userId) return children;
  const all = await getMessages();
  if (await isAdmin(userId)) {
    return (
      <>
        <div className="admin-banner">
          <p className="notice warn">
            {format(all.admin.viewing, { email: server.owner.email })} <Link href={`/admin/servers/${id}`}>{all.admin.openAdmin}</Link>
          </p>
        </div>
        {children}
      </>
    );
  }
  if (!server.members[0]) return children;
  return (
    <>
      <div className="admin-banner">
        <div className="notice row friend-banner">
          <span>{format(all.access.friendBanner, { email: server.owner.email })}</span>
          <LeaveButton id={id} t={all.access} />
        </div>
      </div>
      {children}
    </>
  );
}
