import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { formats } from "../format";
import { botConfigured, botEnabled } from "@/lib/supportBotState";
import { setSupportBotAction } from "./actions";

const SHOWN = 100;

export default async function AdminSupport() {
  await requireAdmin();
  const [all, { locale }, chats, botOn] = await Promise.all([
    getMessages(),
    getPreferences(),
    db.supportChat.findMany({
      orderBy: { lastMessageAt: "desc" },
      take: SHOWN,
      include: {
        user: { select: { email: true } },
        messages: { where: { deletedAt: null }, orderBy: { createdAt: "desc" }, take: 1, select: { body: true, fromStaff: true, bot: true, image: { select: { id: true } } } },
      },
    }),
    botEnabled(),
  ]);
  const configured = botConfigured();
  const t = all.support;
  const f = formats(locale);
  const waiting = chats.filter((c) => !c.lastFromStaff).length;

  return (
    <>
      <header className="stack-tight">
        <h2>{t.admin.title}</h2>
        <p className="muted">{waiting > 0 ? format(t.admin.waitingCount, { n: waiting }) : t.admin.allAnswered}</p>
      </header>
      <section className="card stack-tight">
        <div className="row">
          <h3>🤖 {t.admin.botTitle}</h3>
          <span className={`badge ${botOn && configured ? "online" : "offline"}`}>{botOn && configured ? t.admin.botOn : t.admin.botOff}</span>
        </div>
        <p className="muted small">{t.admin.botIntro}</p>
        {!configured ? (
          <p className="muted small">{t.admin.botNotConfigured}</p>
        ) : (
          <form action={setSupportBotAction.bind(null, !botOn)}>
            <button type="submit" className={botOn ? "secondary small" : "small"}>{botOn ? t.admin.botDisable : t.admin.botEnable}</button>
          </form>
        )}
      </section>
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
                      {lastMsg ? `${lastMsg.bot ? `${t.admin.botMessage}: ` : lastMsg.fromStaff ? `${t.you}: ` : ""}${lastMsg.body || (lastMsg.image ? t.photo : "")}` : ""}
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
