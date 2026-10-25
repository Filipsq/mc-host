import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { getMessages } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { MEMBERS_MAX, SERVER_PERMS, getServerFor, isPerm } from "@/lib/access";
import { addonType } from "@/lib/plugins";
import { planById } from "@/lib/plans";
import InviteForm from "./InviteForm";
import FriendRow from "./FriendRow";

export default async function AccessPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;
  const server = await getServerFor(id, session.user.id, "owner");
  if (!server) notFound();
  const [all, friends] = await Promise.all([
    getMessages(),
    db.serverMember.findMany({ where: { serverId: server.id }, orderBy: { createdAt: "asc" } }),
  ]);
  const t = all.access;
  // Only offer what this server has: no plugins or mods on mod packs and Bedrock, no backups on the free plan.
  const perms = SERVER_PERMS.filter(
    (p) => (p !== "plugins" || addonType(server)) && (p !== "backups" || planById(server.plan).backupsKept > 0),
  );

  return (
    <div className="wide-form stack">
      <header className="stack-tight">
        <h2>{t.title}</h2>
        <p className="muted">{t.intro}</p>
      </header>

      <InviteForm id={server.id} perms={perms} full={friends.length >= MEMBERS_MAX} t={t} />

      <section className="stack">
        <h2>
          {t.listTitle} <span className="muted small">{format(t.count, { n: friends.length, max: MEMBERS_MAX })}</span>
        </h2>
        {friends.length === 0 ? (
          <p className="muted">{t.empty}</p>
        ) : (
          <ul className="friend-list stack">
            {friends.map((f) => (
              <FriendRow
                key={f.id}
                id={server.id}
                friend={{ id: f.id, email: f.email, joined: f.userId !== null, perms: f.perms.filter(isPerm) }}
                perms={perms}
                t={t}
              />
            ))}
          </ul>
        )}
        <p className="muted small">{t.trustNote}</p>
      </section>
    </div>
  );
}
