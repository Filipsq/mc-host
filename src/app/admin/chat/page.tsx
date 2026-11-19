import { requireAdmin } from "@/lib/admin";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { LOBBY_HIDE_REPORTS, lobbyOn, mutedUsers, openReports, readLobby } from "@/lib/lobby";
import { LOBBY_MAX_LENGTH } from "@/lib/lobbyFilter";
import LobbyChat from "@/components/LobbyChat";
import LobbyAdminControls from "./LobbyAdminControls";

export const dynamic = "force-dynamic";

/** The players' chat for the admin: the switch, open reports, who is muted, and the room itself. */
export default async function AdminLobby() {
  const session = await requireAdmin();
  const { locale } = await getPreferences();
  const [all, on, reports, muted, state] = await Promise.all([
    getMessages(),
    lobbyOn(),
    openReports(locale),
    mutedUsers(locale),
    readLobby(session.user!.id!, true, locale),
  ]);
  const t = all.lobby;
  return (
    <>
      <header className="stack-tight">
        <h2>{t.admin.title}</h2>
        <p className="muted">{format(t.admin.intro, { n: LOBBY_HIDE_REPORTS })}</p>
      </header>
      <LobbyAdminControls t={t} on={on} reports={reports} muted={muted} />
      <section className="stack-tight">
        <h3>{t.admin.roomTitle}</h3>
        <p className="muted small">{t.admin.roomHint}</p>
        <LobbyChat t={t} initial={state} maxLength={LOBBY_MAX_LENGTH} />
      </section>
    </>
  );
}
