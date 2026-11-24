import type { Metadata } from "next";
import { Download, ExternalLink } from "lucide-react";
import { db } from "@/lib/db";
import { format } from "@/i18n/messages";
import { getMessages } from "@/i18n/server";
import { LOADER_NAMES, modpackPage } from "@/lib/modpacks";
import { detectVersions, hasPlayerMods, playerModsOpen } from "@/lib/playerMods";

// The players' link from "Mody dla graczy": what the server needs, the two
// downloads and how to install them. Public, never indexed.

type Props = { params: Promise<{ token: string }> };

async function serverFor(token: string) {
  if (!/^[\w-]{10,40}$/.test(token)) return null;
  const server = await db.server.findUnique({ where: { playerModsToken: token } });
  return server && hasPlayerMods(server) && playerModsOpen(server) ? server : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const server = await serverFor((await params).token);
  const t = (await getMessages()).playerMods.page;
  return { title: server ? format(t.metaTitle, { name: server.name }) : t.gone, robots: { index: false, follow: false } };
}

export default async function PlayerModsPage({ params }: Props) {
  const { token } = await params;
  const server = await serverFor(token);
  const all = await getMessages();
  const t = all.playerMods;
  const tp = t.page;
  if (!server) {
    return (
      <main className="wide-form stack">
        <p className="notice">{tp.gone}</p>
      </main>
    );
  }
  const v = await detectVersions(server).catch(() => null);
  const loader = LOADER_NAMES[v?.loader ?? "fabric"];
  const mc = v?.mc ?? server.version;
  const loaderVersion = v?.loaderVersion ?? "";
  const mrpack = !!v?.mc && !!v.loaderVersion;
  const base = `/mody/${token}/pobierz`;
  const pack = server.kind === "modpack" && server.modpack ? (server.modpackTitle ?? server.modpack) : null;

  return (
    <main className="wide-form stack">
      <div className="stack-tight">
        <h1>{format(tp.title, { name: server.name })}</h1>
        <p className="muted">{tp.intro}</p>
        <p className="small mono">{format(tp.versions, { mc, loader, loaderVersion }).trim()}</p>
      </div>

      {pack && (
        <p className="notice small">
          {format(tp.packFirst, { pack, version: server.modpackVersion ?? "" })}{" "}
          <a href={modpackPage(server.modpack!, server.modpackVersionId, server.modpackSource)} target="_blank" rel="noreferrer">
            {format(t.packLink, { pack })} <ExternalLink size={12} aria-hidden />
          </a>
        </p>
      )}

      <section className="card stack">
        <div className="player-mods-downloads">
          {mrpack && (
            <div className="stack-tight">
              <a className="button large" href={`${base}?f=mrpack`} download>
                <Download size={18} aria-hidden /> {t.mrpack}
              </a>
              <span className="muted small">{t.mrpackHint}</span>
            </div>
          )}
          <div className="stack-tight">
            <a className={mrpack ? "button large secondary" : "button large"} href={`${base}?f=zip`} download>
              <Download size={18} aria-hidden /> {t.zip}
            </a>
            <span className="muted small">{t.zipHint}</span>
          </div>
        </div>
      </section>

      <section className="stack">
        <h2>{tp.howTitle}</h2>
        <div className="player-mods-steps">
          {mrpack && (
            <div className="card stack-tight">
              <strong>{tp.mrpackTitle}</strong>
              <ol className="small">
                <li>{tp.mrpack1}</li>
                <li>{tp.mrpack2}</li>
                <li>{format(tp.mrpack3, { loader })}</li>
                <li>{tp.mrpack4}</li>
              </ol>
            </div>
          )}
          <div className="card stack-tight">
            <strong>{tp.zipTitle}</strong>
            <ol className="small">
              <li>{format(tp.zip1, { loader, loaderVersion, mc }).replace("  ", " ")}</li>
              <li>{tp.zip2}</li>
              <li>{format(tp.zip3, { loader })}</li>
            </ol>
          </div>
        </div>
      </section>
    </main>
  );
}
