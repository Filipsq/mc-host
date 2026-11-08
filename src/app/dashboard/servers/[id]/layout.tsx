import Link from "next/link";
import { Users } from "lucide-react";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { getServerAccess, allows, type ServerNeed } from "@/lib/access";
import { offersMinigames } from "@/lib/minigamesSwitch";
import { getMessages } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { getLiveDetailsOnce } from "@/lib/servers";
import { getMetrics } from "@/lib/agent";
import { planById } from "@/lib/plans";
import { maxPlayersFor } from "@/lib/settings";
import { canUpgrade } from "@/lib/upgrade";
import { addonType, offersModPicker } from "@/lib/plugins";
import { kindLabel } from "@/lib/serverType";
import { latestVersionNumber } from "@/lib/addonVersions";
import { EDITION_NAMES } from "@/lib/editions";
import { isTerrariaKind } from "@/lib/terraria";
import { isMinecraft } from "@/lib/otherGames";
import { takesBedrockPlayers } from "@/lib/xbox";
import EditionIcon from "@/components/EditionIcon";
import AutoRefresh from "@/components/AutoRefresh";
import LeaveButton from "./LeaveButton";
import ServerControls from "./ServerControls";
import ServerNav, { type NavGroup } from "./ServerNav";
import ClassicBack from "./ClassicBack";
import PanelViewToggle from "./PanelViewToggle";
import { usesClassicPanel } from "@/lib/panelView";

// Every page of a server's panel sits in one frame: the server's name, state
// and Start/Stop buttons on top, and its menu down the left. Someone opening
// another person's server also sees whose it is: a friend the owner let in,
// or an admin helping.
export default async function ServerLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const [session, { id }] = await Promise.all([getSession(), params]);
  const userId = session?.user?.id;
  const access = userId ? await getServerAccess(id, userId) : null;
  // The pages themselves send strangers away; the frame is only for those let in.
  if (!userId || !access) return <main>{children}</main>;
  const { server } = access;
  const can = (need: ServerNeed) => allows(access, need);

  const [all, { live }, others, owner, latest, classic] = await Promise.all([
    getMessages(),
    getLiveDetailsOnce(server.id, server.status),
    db.server.findMany({
      where: { OR: [{ ownerId: userId }, { members: { some: { userId } } }], NOT: { id: server.id } },
      select: { id: true, name: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    access.role === "owner" ? null : db.user.findUnique({ where: { id: server.ownerId }, select: { email: true } }),
    server.edition === "JAVA" && server.version === "LATEST" ? latestVersionNumber(server.kind) : undefined,
    usesClassicPanel(userId),
  ]);
  const players = live === "online" ? await getMetrics(server.id, "hour").catch(() => null) : null;
  const maxPlayers = players?.maxPlayers ?? maxPlayersFor(server, planById(server.plan));

  const t = all.server;
  const p = all.panel;
  const terraria = server.edition === "TERRARIA";
  const terrariaKind = terraria && isTerrariaKind(server.kind) ? server.kind : null;
  const gameLabel =
    server.edition === "JAVA"
      ? kindLabel(server, all, latest)
      : terrariaKind && terrariaKind !== "vanilla"
        ? all.terraria.kinds[terrariaKind]
        : EDITION_NAMES[server.edition];
  const unpaid = live === "awaitingPayment" || live === "suspended";
  const addons = addonType(server);
  const addonsTitle = addons === "plugin" ? all.plugins.title : addons ? all.mods.title : null;

  // Only what this person may use, and what this server has.
  const groups: NavGroup[] = [
    { items: [{ key: "overview" as const, label: p.overview, path: "" }] },
    {
      title: p.manage,
      items: [
        !unpaid && can("console") && { key: "console" as const, label: p.console, path: "/console" },
        live !== "awaitingPayment" && can("files") && { key: "files" as const, label: all.files.title, path: "/files" },
        can("settings") && { key: "settings" as const, label: all.settings.title, path: "/settings", also: ["/type"] },
        live !== "awaitingPayment" && can("backups") && { key: "backups" as const, label: p.backups, path: "/backups" },
      ].filter(present),
    },
    {
      title: p.game,
      items: [
        live !== "awaitingPayment" && can("files") && isMinecraft(server.edition) && { key: "worlds" as const, label: all.worlds.title, path: "/worlds" },
        addonsTitle && can("plugins") && { key: "plugins" as const, label: addonsTitle, path: "/plugins" },
        (offersModPicker(server) || server.kind === "modpack") && can("plugins") && { key: "mods" as const, label: all.mods.title, path: "/mods" },
        can("owner") && offersMinigames(server) && { key: "minigames" as const, label: all.minigamesSwitch.nav, path: "/minigames" },
        server.edition === "JAVA" && can("owner") && { key: "links" as const, label: all.links.title, path: "/links" },
        can("owner") && takesBedrockPlayers(server) && { key: "xbox" as const, label: all.xbox.nav, path: "/xbox" },
        server.edition === "JAVA" && can("settings") && { key: "resourcepack" as const, label: all.resourcePack.title, path: "/resourcepack" },
      ].filter(present),
    },
    {
      title: p.account,
      items: [
        can("owner") && { key: "billing" as const, label: all.billing.title, path: "/billing" },
        can("owner") && canUpgrade(server) && { key: "upgrade" as const, label: p.upgrade, path: "/upgrade" },
        can("owner") && server.plan !== "FREE" && { key: "addons" as const, label: all.paidAddons.title, path: "/addons" },
        can("owner") && { key: "access" as const, label: all.access.title, path: "/access" },
        can("owner") && { key: "creator" as const, label: all.creator.nav, path: "/creator" },
      ].filter(present),
    },
  ].filter((g) => g.items.length > 0);

  const banners = (
    <>
      {access.role === "admin" && owner && (
        <p className="notice warn">
          {format(all.admin.viewing, { email: owner.email })} <Link href={`/admin/servers/${id}`}>{all.admin.openAdmin}</Link>
        </p>
      )}
      {access.role === "friend" && owner && (
        <div className="notice row friend-banner">
          <span>{format(all.access.friendBanner, { email: owner.email })}</span>
          <LeaveButton id={id} t={all.access} />
        </div>
      )}
    </>
  );

  // The classic look, for those who found it easier: no menu, everything on the
  // overview with a card for each section, and a way back on every other page.
  if (classic) {
    return (
      <main className="stack classic-panel">
        {banners}
        <div className="row classic-top">
          <ClassicBack id={server.id} name={server.name} back={t.back} />
          <PanelViewToggle classic t={p} />
        </div>
        <header className="page-head">
          <div className="page-title">
            <EditionIcon edition={server.edition} size={52} />
            <div>
              <h1 className="row">
              {server.name}
              {can("owner") && (
                <Link className="button secondary small" href={`/dashboard/servers/${id}/settings#nazwa`}>
                  {all.settings.rename.button}
                </Link>
              )}
            </h1>
              <div className="meta">
                <span className="chip">{gameLabel}</span>
                <span className="chip">{all.plans[server.plan]}</span>
                <span className="chip">{server.memoryMb / 1024} GB RAM</span>
                {players && (
                  <span className="chip" title={p.playersLabel}>
                    <Users size={14} aria-hidden /> {format(p.players, { n: players.online ?? players.players.length, max: maxPlayers })}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="classic-state">
            <span className={`badge ${live}`}>{t.live[live]}</span>
            <ServerControls id={server.id} live={live} t={t} />
          </div>
        </header>
        <div className="classic-content">{children}</div>
        {(live === "starting" || live === "restarting") && <AutoRefresh />}
      </main>
    );
  }

  return (
    <main className="server-panel">
      {banners}
      {/* The same spot as in the classic look, so switching back and forth stays under the cursor. */}
      <div className="row classic-top">
        <span />
        <PanelViewToggle classic={false} t={p} />
      </div>
      <header className="card server-head">
        <div className="server-head-title">
          <span className="server-head-icon">
            <EditionIcon edition={server.edition} size={44} />
          </span>
          <div>
            <h1 className="row">
              {server.name}
              {can("owner") && (
                <Link className="button secondary small" href={`/dashboard/servers/${id}/settings#nazwa`}>
                  {all.settings.rename.button}
                </Link>
              )}
            </h1>
            <div className="meta">
              <span className={`badge ${live}`}>{t.live[live]}</span>
              <span className="chip">{gameLabel}</span>
              <span className="chip">
                {all.plans[server.plan]} · {server.memoryMb / 1024} GB RAM
              </span>
              {players && (
                <span className="chip" title={p.playersLabel}>
                  <Users size={14} aria-hidden /> {format(p.players, { n: players.online ?? players.players.length, max: maxPlayers })}
                </span>
              )}
            </div>
          </div>
        </div>
        <ServerControls id={server.id} live={live} t={t} />
      </header>
      <div className="server-body">
        <ServerNav
          id={server.id}
          name={server.name}
          groups={groups}
          others={others}
          t={{ menu: p.menu, servers: p.servers, switchServer: p.switchServer }}
        />
        <div className="server-content">{children}</div>
      </div>
      {(live === "starting" || live === "restarting") && <AutoRefresh />}
    </main>
  );
}

const present = <T,>(item: T | false | null | undefined | ""): item is T => !!item;
