import Link from "next/link";
import type { Server } from "@prisma/client";
import { Blocks, FolderOpen, Gamepad2, Gift, Globe, Joystick, Link2, PackagePlus, Palette, Puzzle, Users } from "lucide-react";
import { getMessages } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { db } from "@/lib/db";
import type { ServerNeed } from "@/lib/access";
import type { LiveState } from "@/lib/servers";
import { serverAddons } from "@/lib/addons";
import { addonType, offersModPicker } from "@/lib/plugins";
import { offersMinigames } from "@/lib/minigamesSwitch";
import { isModLoader } from "@/lib/modpacks";
import { isMinecraft } from "@/lib/otherGames";
import { isTerrariaKind } from "@/lib/terraria";
import { takesBedrockPlayers } from "@/lib/xbox";
import { activeLevel } from "@/lib/worlds";
import Stats from "./Stats";
import Console from "./Console";
import BackupsSection from "./BackupsSection";

type Props = { server: Server; live: LiveState; can: (need: ServerNeed) => boolean; locale: string };

/**
 * The rest of the overview in the classic panel (src/lib/panelView.ts), as it
 * was before the menu on the left: a card with a button for each section, then
 * the stats, the console and the backups, all on one page.
 */
export default async function ClassicOverview({ server, live, can, locale }: Props) {
  const [all, friends] = await Promise.all([
    getMessages(),
    can("owner") ? db.serverMember.count({ where: { serverId: server.id } }) : 0,
  ]);
  const t = all.server;
  const base = `/dashboard/servers/${server.id}`;
  const unpaid = live === "awaitingPayment" || live === "suspended";
  const terraria = server.edition === "TERRARIA";
  const terrariaKind = terraria && isTerrariaKind(server.kind) ? server.kind : null;
  // Plugins on Paper, mods on a mod loader; the card reads accordingly.
  const addons = {
    plugin: all.plugins,
    mod: { ...all.plugins, ...all.mods },
    workshop: { ...all.plugins, ...all.mods, ...all.workshop },
    none: null,
  }[addonType(server) ?? "none"];
  // Pages that came after the classic look had a card of their own.
  const more = [
    (offersModPicker(server) || server.kind === "modpack") && can("plugins") && { href: "/mods", label: all.mods.title, Icon: Blocks },
    can("owner") && offersMinigames(server) && { href: "/minigames", label: all.minigamesSwitch.nav, Icon: Gamepad2 },
    server.edition === "JAVA" && can("owner") && { href: "/links", label: all.links.title, Icon: Link2 },
    can("owner") && takesBedrockPlayers(server) && { href: "/xbox", label: all.xbox.nav, Icon: Joystick },
    server.edition === "JAVA" && can("settings") && { href: "/resourcepack", label: all.resourcePack.title, Icon: Palette },
    can("owner") && { href: "/creator", label: all.creator.nav, Icon: Gift },
  ].filter((x) => !!x);

  return (
    <>
      {can("owner") && server.plan !== "FREE" && (
        <div className="card row">
          <span>
            <strong>{all.paidAddons.title}</strong>{" "}
            <span className="muted">· {serverAddons(server).map((a) => all.paidAddons.names[a]).join(", ") || all.paidAddons.cardNone}</span>
          </span>
          <Link className="button secondary" href={`${base}/addons`}>
            <PackagePlus size={16} aria-hidden /> {all.paidAddons.manage}
          </Link>
        </div>
      )}

      {live !== "awaitingPayment" && can("files") && (
        <div className="card row">
          <span>
            <strong>{all.files.title}</strong>{" "}
            <span className="muted">
              · {terraria ? all.files.cardTextTerraria : server.kind === "modpack" || isModLoader(server.kind) ? all.files.cardTextMods : all.files.cardText}
            </span>
          </span>
          <Link className="button secondary" href={`${base}/files`}>
            <FolderOpen size={16} aria-hidden /> {all.files.open}
          </Link>
        </div>
      )}

      {live !== "awaitingPayment" && can("files") && isMinecraft(server.edition) && (
        <div className="card row">
          <span>
            <strong>{all.worlds.title}</strong>{" "}
            <span className="muted">
              · {format(all.worlds.cardCurrent, { name: activeLevel(server) })} · {all.worlds.cardText}
            </span>
          </span>
          <Link className="button secondary" href={`${base}/worlds`}>
            <Globe size={16} aria-hidden /> {all.worlds.open}
          </Link>
        </div>
      )}

      {addons && can("plugins") && (
        <div className="card row">
          <span>
            <strong>{addons.title}</strong>{" "}
            <span className="muted">· {server.plugins.length > 0 ? format(addons.cardCount, { n: server.plugins.length }) : addons.cardNone}</span>
            {server.pluginsPending && <span className="muted"> · {addons.pending}</span>}
          </span>
          <Link className="button secondary" href={`${base}/plugins`}>
            <Puzzle size={16} aria-hidden /> {addons.manage}
          </Link>
        </div>
      )}

      {can("owner") && (
        <div className="card row">
          <span>
            <strong>{all.access.title}</strong>{" "}
            <span className="muted">· {friends > 0 ? format(all.access.cardCount, { n: friends }) : all.access.cardNone}</span>
          </span>
          <Link className="button secondary" href={`${base}/access`}>
            <Users size={16} aria-hidden /> {all.access.manage}
          </Link>
        </div>
      )}

      {more.length > 0 && (
        <div className="card row">
          <strong>{all.panel.more}</strong>
          <span className="row">
            {more.map(({ href, label, Icon }) => (
              <Link key={href} className="button secondary small" href={base + href}>
                <Icon size={16} aria-hidden /> {label}
              </Link>
            ))}
          </span>
        </div>
      )}

      {!unpaid && (
        <Stats
          id={server.id}
          java={server.edition === "JAVA"}
          running={live === "online" || live === "starting" || live === "restarting"}
          memoryMb={server.memoryMb}
          locale={locale}
          t={t.stats}
        />
      )}

      {!unpaid && can("console") &&
        (server.edition === "VALHEIM" || server.edition === "HYTALE" ? (
          <Console
            id={server.id}
            game={null}
            input={server.edition !== "VALHEIM"}
            note={server.edition === "VALHEIM" ? all.otherGames.valheim.consoleNote : all.otherGames.hytale.consoleNote}
            t={t}
          />
        ) : (
          <Console
            id={server.id}
            game={terraria ? (terrariaKind === "tshock" ? "tshock" : "terraria") : server.edition === "BEDROCK" ? "bedrock" : "java"}
            t={t}
          />
        ))}

      {live !== "awaitingPayment" && can("backups") && <BackupsSection server={server} />}
    </>
  );
}
