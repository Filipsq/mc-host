import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { getMessages, getPreferences } from "@/i18n/server";
import { CHAT_RATE, MAX_LENGTH, readChat } from "@/lib/support";
import SupportChat from "@/components/SupportChat";

type Props = { params: Promise<{ userId: string }> };

export default async function AdminChat({ params }: Props) {
  await requireAdmin();
  const { userId } = await params;
  const [all, { locale }, user] = await Promise.all([
    getMessages(),
    getPreferences(),
    db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        supportChat: { select: { staffUnread: true } },
        servers: { orderBy: { createdAt: "desc" }, select: { id: true, name: true, plan: true, status: true } },
      },
    }),
  ]);
  if (!user) notFound();
  const t = all.support;
  const state = await readChat(userId, "staff", locale);

  return (
    <>
      <Link className="back" href="/admin/support">← {t.admin.title}</Link>
      <header className="page-head">
        <div className="stack-tight">
          <h2 className="break">{user.email}</h2>
          <p className="muted small">{t.admin.replyHint}</p>
        </div>
        <Link className="button secondary small" href={`/admin/users/${user.id}`}>{t.admin.profile}</Link>
      </header>
      <div className="chat-servers">
        <span className="muted small">{all.admin.nav.servers}:</span>
        {user.servers.length === 0 ? (
          <span className="muted small">{t.admin.noServers}</span>
        ) : (
          user.servers.map((s) => (
            <Link key={s.id} className="chip" href={`/admin/servers/${s.id}`}>
              {s.name} · {all.plans[s.plan]} · {all.admin.statuses[s.status]}
            </Link>
          ))
        )}
      </div>
      <SupportChat
        t={t}
        initial={state}
        chat={user.id}
        otherName={user.email}
        maxLength={MAX_LENGTH}
        rate={CHAT_RATE}
        hadUnread={(user.supportChat?.staffUnread ?? 0) > 0}
      />
    </>
  );
}
