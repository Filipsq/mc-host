import Link from "next/link";
import CopyForClaude from "@/components/CopyForClaude";
import { Users } from "lucide-react";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { getServerAccess, allows, type ServerNeed } from "@/lib/access";
import { offersMinigames } from "@/lib/minigamesSwitch";
import { getMessages } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { getLiveDetailsOnce } from "@/lib/servers";
import { getMetrics } from "@/lib/agent";
import { formatPrice, planById } from "@/lib/plans";
import { periodPrice } from "@/lib/periods";
import { getPreferences } from "@/i18n/server";
import { maxPlayersFor } from "@/lib/settings";
import { canUpgrade } from "@/lib/upgrade";
import { addonType, canCrossplay, canRunNonPremium, offersModPicker } from "@/lib/plugins";
import { kindLabel } from "@/lib/serverType";
import { latestVersionNumber } from "@/lib/addonVersions";
import { EDITION_NAMES } from "@/lib/editions";
import { isTerrariaKind } from "@/lib/terraria";
import { isMinecraft } from "@/lib/otherGames";
import { takesBedrockPlayers } from "@/lib/xbox";
import { takesBedrockAddons } from "@/lib/bedrockAddons";
import EditionIcon from "@/components/EditionIcon";
import AutoRefresh from "@/components/AutoRefresh";
import AdBox from "@/components/AdBox";
import { ADSENSE_SLOT } from "@/lib/ads";
import LeaveButton from "./LeaveButton";
import ServerControls from "./ServerControls";
import QueueNotice from "./QueueNotice";
import { queuePlace } from "@/lib/startQueue";
import LiveBadge from "./LiveBadge";
import ServerNav, { type NavGroup } from "./ServerNav";
import PanelSearch, { type SearchItem } from "./PanelSearch";
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
        live !== "awaitingPayment" && can("files") && takesBedrockAddons(server) && { key: "bedrockAddons" as const, label: all.bedrockAddons.title, path: "/bedrock-addons" },
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
        can("owner") && (server.plan !== "FREE" || server.edition === "JAVA") && { key: "addons" as const, label: all.paidAddons.title, path: "/addons" },
        can("owner") && { key: "access" as const, label: all.access.title, path: "/access" },
        can("owner") && { key: "creator" as const, label: all.creator.nav, path: "/creator" },
      ].filter(present),
    },
  ].filter((g) => g.items.length > 0);

  // The search box (Ctrl+K): every menu page, plus the single options inside
  // them, so "whitelist" or "pvp" lands on the very field. Only what's on screen
  // for this server and this person; the words it also answers to are in panelSearch.keywords.
  const kw = all.panelSearch.keywords;
  const st = all.settings;
  const java = server.edition === "JAVA";
  const settingsAt = { kind: "option" as const, where: st.title, path: "/settings" };
  const field = (key: keyof typeof kw, label: string, name: string, icon: SearchItem["icon"] = "option"): SearchItem => ({
    ...settingsAt, label, field: name, icon, keywords: kw[key],
  });
  const options: (SearchItem | false)[] = [];
  if (can("settings")) {
    if (server.edition === "JAVA" || server.edition === "BEDROCK") {
      options.push(
        java && field("version", st.version, "version"),
        field("gameMode", st.gameMode, "gameMode"),
        field("difficulty", st.difficulty, "difficulty"),
        field("motd", st.motd, "motd"),
        field("maxPlayers", st.maxPlayers, "maxPlayers"),
        java && field("pvp", st.pvp, "pvp"),
        java && field("allowFlight", st.allowFlight, "allowFlight"),
        java && field("hardcore", st.hardcore, "hardcore"),
        java && field("commandBlocks", st.commandBlocks, "commandBlocks"),
        java && field("allowNether", st.allowNether, "allowNether"),
        java && field("allowEnd", st.allowEnd, "allowEnd"),
        java && field("spawnMonsters", st.spawnMonsters, "spawnMonsters"),
        java && field("forceGamemode", st.forceGamemode, "forceGamemode"),
        java && field("spawnProtection", st.spawnProtection, "spawnProtection"),
        java && field("viewDistance", st.viewDistance, "viewDistance"),
        java && canRunNonPremium(server) && field("nonPremium", st.nonPremium, "nonPremium"),
        java && canCrossplay(server) && field("crossplay", st.crossplay, "crossplay"),
        field("whitelist", st.whitelist, "whitelist"),
        java && field("icon", st.icon, "icon-upload", "icon"),
      );
    } else if (server.edition === "TERRARIA") {
      options.push(field("motd", st.motd, "motd"), field("password", all.terraria.password, "password", "password"));
    } else if (server.edition === "VALHEIM") {
      options.push(field("password", all.otherGames.valheim.password, "password", "password"), field("preset", all.otherGames.valheim.preset, "preset"));
    }
    if (access.role !== "friend" && server.edition !== "VALHEIM" && server.edition !== "HYTALE" && server.edition !== "TERRARIA") {
      options.push(field("name", st.rename.name, "name", "name"), java && field("subdomain", st.rename.address, "subdomain", "address"));
    }
    if (can("owner")) options.push({ ...settingsAt, label: all.panel.danger, anchor: "usun", icon: "delete", keywords: kw.delete });
  }
  if (java && can("owner")) {
    options.push(
      { kind: "page", label: all.serverType.title, path: "/type", icon: "type", keywords: kw.type },
      { kind: "page", label: all.paidAddons.address.title, path: "/address", icon: "address", keywords: kw.address },
    );
  }
  const searchItems: SearchItem[] = [
    ...groups.flatMap((g) =>
      g.items.map((item): SearchItem => ({ kind: "page", label: item.label, where: g.title, path: item.path, icon: item.key, keywords: kw[item.key] })),
    ),
    ...options.filter(present),
  ];
  const search = <PanelSearch id={server.id} items={searchItems} t={all.panelSearch} />;

  const { locale, currency } = await getPreferences();
  const queued = !!server.queuedAt && server.plan === "FREE" && !(live === "online" || live === "starting");
  const queue = queued ? await queuePlace(server.queuedAt!).catch(() => null) : null;
  const banners = (
    <>
      {queued && queue && (
        <QueueNotice
          id={server.id}
          since={server.queuedAt!.getTime()}
          waiting={queue.waiting}
          place={queue.place}
          owner={can("owner")}
          price={formatPrice(periodPrice(planById("STARTER").price[currency], 7), currency, locale)}
          t={t.queue}
        />
      )}
      {access.role === "admin" && owner && (
        <div className="notice warn row">
          <span>
            {format(all.admin.viewing, { email: owner.email })} <Link href={`/admin/servers/${id}`}>{all.admin.openAdmin}</Link>
          </span>
          <CopyForClaude target={{ serverId: id }} t={all.admin.copyForClaude} />
        </div>
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
          <span className="row-inline">
            {search}
            <PanelViewToggle classic t={p} />
          </span>
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
            <LiveBadge id={server.id} live={live} labels={t.live} stopping={t.doing.stopState} />
            <ServerControls id={server.id} live={live} t={t} />
          </div>
        </header>
        <div className="classic-content">{children}</div>
        {(live === "starting" || live === "restarting") && <AutoRefresh />}
      </main>
    );
  }

  // Free servers get a tall ad right of the panel on wide screens; paid ones never see ads.
  const sideAd = !!ADSENSE_SLOT && server.plan === "FREE" && !server.adminTest;

  return (
    <main className={sideAd ? "server-panel with-side-ad" : "server-panel"}>
      {banners}
      {/* The same spot as in the classic look, so switching back and forth stays under the cursor. */}
      <div className="row classic-top">
        {search}
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
              <LiveBadge id={server.id} live={live} labels={t.live} stopping={t.doing.stopState} />
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
          t={{ menu: p.menu, servers: p.servers, switchServer: p.switchServer, more: p.tabMore, close: p.closeMenu }}
        />
        <div className="server-content">{children}</div>
        {sideAd && (
          <div className="side-ad">
            <AdBox label={all.dashboard.adLabel} blockedLabel={all.dashboard.adBlocked} variant="side" />
          </div>
        )}
      </div>
      {(live === "starting" || live === "restarting") && <AutoRefresh />}
    </main>
  );
}

const present = <T,>(item: T | false | null | undefined | ""): item is T => !!item;
