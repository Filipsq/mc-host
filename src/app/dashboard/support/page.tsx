import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { isAdmin } from "@/lib/admin";
import { db } from "@/lib/db";
import { getMessages, getPreferences } from "@/i18n/server";
import { CHAT_RATE, MAX_LENGTH, readChat } from "@/lib/support";
import SupportChat from "@/components/SupportChat";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).support.title };
}

export default async function SupportPage() {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  // Admins answer chats rather than having one.
  if (await isAdmin(userId)) redirect("/admin/support");

  const [all, { locale }, before] = await Promise.all([
    getMessages(),
    getPreferences(),
    db.supportChat.findUnique({ where: { userId }, select: { userUnread: true } }),
  ]);
  const t = all.support;
  const state = await readChat(userId, "user", locale);

  return (
    <main className="stack">
      <Link className="back" href="/dashboard">← {all.dashboard.title}</Link>
      <header>
        <h1>{t.title}</h1>
        <p className="muted">{t.subtitle}</p>
      </header>
      <SupportChat
        t={t}
        initial={state}
        otherName={t.staff}
        maxLength={MAX_LENGTH}
        rate={CHAT_RATE}
        hadUnread={(before?.userUnread ?? 0) > 0}
      />
    </main>
  );
}
