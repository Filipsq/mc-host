import type { Server } from "@prisma/client";
import { Download, ExternalLink } from "lucide-react";
import { getMessages } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { siteUrl } from "@/lib/site";
import { LOADER_NAMES, modpackPage } from "@/lib/modpacks";
import { hasPlayerMods, loaderOf, playerModsOpen } from "@/lib/playerMods";
import CopyButton from "@/components/CopyButton";
import { PlayerModsLink, PlayerModsList } from "./PlayerModsParts";

/**
 * "Mody dla graczy" on a mod server's Mods page: the players' pack as .mrpack
 * or ZIP, a public link to give players, and (folded) what goes in it.
 */
export default async function PlayerMods({ server }: { server: Server }) {
  if (!hasPlayerMods(server)) return null;
  const all = await getMessages();
  const t = all.playerMods;
  if (server.status === "AWAITING_PAYMENT") {
    return (
      <section className="card stack-tight" id="dla-graczy">
        <h3>{t.title}</h3>
        <p className="muted small">{t.notYet}</p>
      </section>
    );
  }
  const api = `/api/servers/${server.id}/player-mods`;
  const link = server.playerModsToken ? `${siteUrl()}/mody/${server.playerModsToken}` : null;
  const loader = LOADER_NAMES[loaderOf(server)];
  const pack = server.kind === "modpack" && server.modpack ? (server.modpackTitle ?? server.modpack) : null;

  return (
    <section className="card stack" id="dla-graczy">
      <div className="stack-tight">
        <h3>{t.title}</h3>
        <p className="muted small">{t.intro}</p>
      </div>
      {pack && (
        <p className="small">
          {format(t.packFirst, { pack, version: server.modpackVersion ?? "" })}{" "}
          <a href={modpackPage(server.modpack!, server.modpackVersionId, server.modpackSource)} target="_blank" rel="noreferrer">
            {format(t.packLink, { pack })} <ExternalLink size={12} aria-hidden />
          </a>
        </p>
      )}
      <div className="player-mods-downloads">
        <div className="stack-tight">
          <a className="button" href={`${api}?f=mrpack`} download>
            <Download size={16} aria-hidden /> {t.mrpack}
          </a>
          <span className="muted small">{t.mrpackHint}</span>
        </div>
        <div className="stack-tight">
          <a className="button secondary" href={`${api}?f=zip`} download>
            <Download size={16} aria-hidden /> {t.zip}
          </a>
          <span className="muted small">{t.zipHint}</span>
        </div>
      </div>

      <div className="stack-tight">
        <strong>{t.linkTitle}</strong>
        {!playerModsOpen(server) ? (
          <span className="muted small">{t.suspended}</span>
        ) : (
          <>
            <span className="muted small">{t.linkText}</span>
            {link ? (
              <div className="player-mods-link">
                <input readOnly value={link} aria-label={t.linkTitle} className="mono" />
                <CopyButton text={link} label={t.copy} copiedLabel={t.copied} />
                <PlayerModsLink id={server.id} has t={t} />
              </div>
            ) : (
              <PlayerModsLink id={server.id} has={false} t={t} />
            )}
          </>
        )}
      </div>

      <PlayerModsList api={api} loader={loader} t={t} />
    </section>
  );
}
