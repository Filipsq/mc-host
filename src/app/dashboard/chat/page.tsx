import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { isAdmin } from "@/lib/admin";
import { getMessages, getPreferences } from "@/i18n/server";
import { readLobby } from "@/lib/lobby";
import { LOBBY_MAX_LENGTH } from "@/lib/lobbyFilter";
import LobbyChat from "@/components/LobbyChat";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).lobby.title };
}

/** The players' chat on a page of its own (the help bubble has it in a tab). */
export default async function LobbyPage() {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  if (await isAdmin(userId)) redirect("/admin/chat");
  const [all, { locale }] = await Promise.all([getMessages(), getPreferences()]);
  const state = await readLobby(userId, false, locale);
  return (
    <main className="stack">
      <Link className="back" href="/dashboard">← {all.dashboard.title}</Link>
      <header>
        <h1>{all.lobby.title}</h1>
        <p className="muted">{all.lobby.subtitle}</p>
      </header>
      <LobbyChat t={all.lobby} initial={state} maxLength={LOBBY_MAX_LENGTH} />
    </main>
  );
}
