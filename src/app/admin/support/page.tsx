import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import AutoRefresh from "@/components/AutoRefresh";
import { formats } from "../format";

const SHOWN = 100;

export default async function AdminSupport() {
  await requireAdmin();
  const [all, { locale }, chats] = await Promise.all([
    getMessages(),
    getPreferences(),
    db.supportChat.findMany({
      orderBy: { lastMessageAt: "desc" },
      take: SHOWN,
      include: {
        user: { select: { email: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, fromStaff: true } },
      },
    }),
  ]);
  const t = all.support;
  const f = formats(locale);
  const waiting = chats.filter((c) => !c.lastFromStaff).length;

  return (
    <>
      <AutoRefresh everyMs={8000} />
      <header className="stack-tight">
        <h2>{t.admin.title}</h2>
        <p className="muted">{waiting > 0 ? format(t.admin.waitingCount, { n: waiting }) : t.admin.allAnswered}</p>
      </header>
      {chats.length === 0 ? (
        <p className="muted">{t.admin.none}</p>
      ) : (
        <ul className="card flush chat-list">
          {chats.map((c) => {
            const lastMsg = c.messages[0];
            return (
              <li key={c.userId}>
                <Link href={`/admin/support/${c.userId}`} className={c.staffUnread > 0 ? "unread" : undefined}>
                  <span className="chat-list-main">
                    <strong className="break">{c.user.email}</strong>
                    <span className="chat-preview muted">
                      {lastMsg ? `${lastMsg.fromStaff ? `${t.you}: ` : ""}${lastMsg.body}` : ""}
                    </span>
                  </span>
                  <span className="chat-list-side">
                    <span className="muted small nowrap">{f.dateTime(c.lastMessageAt)}</span>
                    {c.staffUnread > 0 ? (
                      <span className="count-badge">{c.staffUnread}</span>
                    ) : !c.lastFromStaff ? (
                      <span className="badge starting">{t.admin.waiting}</span>
                    ) : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {chats.length === SHOWN && <p className="muted small">{format(all.admin.shown, { n: SHOWN })}</p>}
    </>
  );
}
