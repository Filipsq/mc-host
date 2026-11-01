import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ExternalLink, Mic, Package, Puzzle, Search } from "lucide-react";
import { getSession } from "@/lib/session";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { getServerFor } from "@/lib/access";
import { getPluginInfos, searchAddons } from "@/lib/modrinth";
import { curseforgeEnabled, getCurseforgeModInfos, searchCurseforgeMods } from "@/lib/curseforge";
import { getSitePluginInfos, searchSitePlugins } from "@/lib/sitePlugins";
import { downloadVersion, versionsToCheck } from "@/lib/addonVersions";
import {
  GAME_MODE_PLUGINS,
  KNOWN_PLUGINS,
  PLUGIN_SETS,
  VOICE_CHAT,
  addonType,
  curseforgeMod,
  curseforgeModPage,
  hasCurseforgeMod,
  pluginIds,
  pluginPage,
  setFits,
  sitePlugin,
  type PluginSite,
} from "@/lib/plugins";
import { voiceAddress } from "@/lib/servers";
import CopyButton from "@/components/CopyButton";
import { LOADER_NAMES, isServerKind } from "@/lib/modpacks";
import { KNOWN_TMOD_TITLES, POPULAR_TMOD_MODS, workshopPage } from "@/lib/terraria";
import { getWorkshopTitles } from "@/lib/steam";
import { AddPluginButton, AddSetButton, AddWorkshopForm, ApplyPlugins, RemovePluginButton } from "./PluginButtons";

const FABRIC_API = "P7dR8mSH"; // added for CurseForge mods that need it

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; src?: string }> };

export default async function PluginsPage({ params, searchParams }: Props) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const [{ id }, { q = "", src }] = await Promise.all([params, searchParams]);
  const server = await getServerFor(id, session.user.id, "plugins");
  if (!server) notFound();
  const [all, { locale }] = await Promise.all([getMessages(), getPreferences()]);
  const type = addonType(server);
  // Mod servers use the same page with mod wording.
  const t = type === "mod" ? { ...all.plugins, ...all.mods } : all.plugins;

  if (!type) {
    return (
      <div className="wide-form stack">
        <h2>{t.title}</h2>
        <p className="notice">{{ BEDROCK: t.notBedrock, TERRARIA: t.notTerraria, VALHEIM: t.notOtherGame, HYTALE: t.notOtherGame, JAVA: t.notModpack }[server.edition]}</p>
      </div>
    );
  }

  if (type === "workshop") {
    const tw = { ...all.plugins, ...all.mods, ...all.workshop };
    const titles = await getWorkshopTitles(server.plugins);
    return (
      <div className="stack">
        <h2>{tw.title}</h2>
        <p className="muted">{tw.intro}</p>
        <ApplyPlugins id={server.id} pending={server.pluginsPending} t={tw} />
        <section className="stack">
          <h2>{tw.installed}</h2>
          <ul className="card plugin-list">
            {server.plugins.map((wid) => {
              const title = titles.get(wid) ?? KNOWN_TMOD_TITLES[wid] ?? wid;
              return (
                <li key={wid}>
                  <span className="plugin-icon"><Puzzle size={20} aria-hidden /></span>
                  <span className="plugin-main">
                    <strong>{title}</strong>
                    <a className="small" href={workshopPage(wid)} target="_blank" rel="noreferrer">
                      {tw.onSteam} <ExternalLink size={12} aria-hidden />
                    </a>
                  </span>
                  <RemovePluginButton id={server.id} pluginId={wid} title={title} t={tw} />
                </li>
              );
            })}
            {server.plugins.length === 0 && <li className="muted">{tw.none}</li>}
          </ul>
          <p className="muted small">
            {tw.config} <Link href={`/dashboard/servers/${server.id}/files?path=tModLoader`}>{tw.openConfig}</Link>
          </p>
        </section>
        <section className="stack">
          <h2>{tw.addLink}</h2>
          <p className="muted">{tw.addLinkHint}</p>
          <AddWorkshopForm id={server.id} t={tw} placeholder={tw.linkPlaceholder} />
        </section>
        <section className="stack">
          <h2>{tw.popular}</h2>
          <ul className="card plugin-list">
            {POPULAR_TMOD_MODS.map((m) => (
              <li key={m.id}>
                <span className="plugin-icon"><Package size={20} aria-hidden /></span>
                <span className="plugin-main">
                  <a href={workshopPage(m.id)} target="_blank" rel="noreferrer">
                    <strong>{m.title}</strong>
                  </a>
                  <span className="muted small">{tw.popularHints[m.id as keyof typeof tw.popularHints]}</span>
                  {m.with.length > 0 && (
                    <span className="small">{format(tw.withMods, { list: m.with.map((w) => KNOWN_TMOD_TITLES[w] ?? w).join(", ") })}</span>
                  )}
                  {"ramGb" in m && <span className="ram-pill">{format(all.server.ramFrom, { gb: m.ramGb })}</span>}
                </span>
                <AddPluginButton id={server.id} pluginId={m.id} added={server.plugins.includes(m.id)} t={tw} />
              </li>
            ))}
          </ul>
        </section>
      </div>
    );
  }

  const query = q.trim().slice(0, 100);
  // Servers on a chosen version only see what's made for it; game modes run the newest version.
  const mc = (server.kind === "vanilla" || server.kind === "halloween" || type === "mod") && server.version !== "LATEST" ? server.version : undefined;
  // What it runs, "Najnowsza" included (null: the game mode picks), for Modrinth and Hangar.
  const runs = await versionsToCheck(server.kind, server.version);
  const runsOn = runs ? downloadVersion(runs) : undefined;
  // Mod servers can also take mods from CurseForge, when it's set up.
  const cfOffered = type === "mod" && curseforgeEnabled();
  const fromCf = cfOffered && src === "cf";
  // Plugins also come from Hangar and SpigotMC; the panel downloads those itself.
  const site: PluginSite | null = type === "plugin" && (src === "hangar" || src === "spigot") ? src : null;
  const sources = type === "plugin" ? ["", "hangar", "spigot"] : cfOffered ? ["", "cf"] : [];
  const sourceNames: Record<string, string> = {
    "": all.mods.sourceModrinth,
    cf: all.mods.sourceCurseforge,
    hangar: all.plugins.sourceHangar,
    spigot: all.plugins.sourceSpigot,
  };
  const active = fromCf ? "cf" : (site ?? "");
  const cfIds = server.plugins.map((p) => curseforgeMod(p)?.modId).filter((m) => m !== undefined);
  const [infos, cfInfos, siteInfos, results, cfResults, siteResults] = await Promise.all([
    getPluginInfos(server.plugins.filter((p) => !curseforgeMod(p) && !sitePlugin(p))),
    getCurseforgeModInfos(cfIds),
    getSitePluginInfos(server.plugins.filter((p) => sitePlugin(p))),
    fromCf || site ? null : searchAddons(type, query, { gameVersion: runsOn, loader: server.kind }),
    // A CurseForge file is picked for one Minecraft version, so "newest" has none.
    fromCf && mc ? searchCurseforgeMods(query, { gameVersion: mc, loader: server.kind }) : null,
    site ? searchSitePlugins(site, query, site === "hangar" ? runsOn : undefined) : null,
  ]);
  const searchHref = (from: string) => `/dashboard/servers/${server.id}/plugins?${new URLSearchParams({ ...(query && { q: query }), ...(from && { src: from }) })}#szukaj`;
  const kind = isServerKind(server.kind) ? server.kind : "vanilla";
  const included = GAME_MODE_PLUGINS[kind] ?? [];
  const numbers = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
  const sets = type === "plugin" ? PLUGIN_SETS.filter((set) => setFits(set, kind)) : [];
  const loader = LOADER_NAMES[server.kind] ?? server.kind;
  const forPlayers = <span className="chip small-chip">{all.mods.forPlayers}</span>;
  // Names for plugins from the sets, in case Modrinth doesn't answer.
  const knownTitle = (pid: string) =>
    pid === VOICE_CHAT.id ? VOICE_CHAT.title : (Object.values(KNOWN_PLUGINS).find((p) => p.id === pid)?.title ?? (pid === FABRIC_API ? "Fabric API" : undefined));
  const voice = voiceAddress(server);
  const tv = all.voice;

  return (
    <div className="stack">
      <h2>{t.title}</h2>
      <p className="muted">
        {type === "mod" ? format(all.mods.introMods, { loader, version: server.version === "LATEST" ? all.settings.latest : server.version }) : t.intro}
      </p>
      {type === "mod" && (
        <p className="notice">
          {format(all.mods.noPlugins, { loader })}{" "}
          <Link href={`/dashboard/servers/${server.id}/type`}>{all.mods.noPluginsSwitch}</Link>
        </p>
      )}
      <ApplyPlugins id={server.id} pending={server.pluginsPending} t={t} />

      <section className="stack">
        <h2>{t.installed}</h2>
        <ul className="card plugin-list">
          {included.map((p) => (
            <li key={p.slug}>
              <span className="plugin-icon"><Puzzle size={20} aria-hidden /></span>
              <span className="plugin-main">
                <strong>{p.title}</strong>
                <span className="muted small">{format(t.included, { kind: all.server.kinds[kind] })}</span>
              </span>
            </li>
          ))}
          {server.plugins.map((pid) => {
            const fromSite = sitePlugin(pid);
            if (fromSite) {
              const p = siteInfos.get(pid);
              const title = p?.title ?? `${sourceNames[fromSite.site]} ${fromSite.ref}`;
              return (
                <li key={pid}>
                  <PluginIcon src={p?.icon} />
                  <span className="plugin-main">
                    <strong>{title}</strong>
                    {p && (
                      <a className="small" href={p.page} target="_blank" rel="noreferrer">
                        {sourceNames[fromSite.site]} <ExternalLink size={12} aria-hidden />
                      </a>
                    )}
                  </span>
                  <RemovePluginButton id={server.id} pluginId={pid} title={title} t={t} />
                </li>
              );
            }
            const cf = curseforgeMod(pid);
            if (cf) {
              const m = cfInfos.get(cf.modId);
              const title = m?.title ?? `CurseForge ${cf.modId}`;
              return (
                <li key={pid}>
                  <PluginIcon src={m?.icon} />
                  <span className="plugin-main">
                    <strong>{title}</strong>
                    {m && (
                      <a className="small" href={curseforgeModPage(m.slug)} target="_blank" rel="noreferrer">
                        {all.mods.onCurseforge} <ExternalLink size={12} aria-hidden />
                      </a>
                    )}
                  </span>
                  <RemovePluginButton id={server.id} pluginId={pid} title={title} t={t} />
                </li>
              );
            }
            const p = infos.get(pid);
            const title = p?.title ?? knownTitle(pid) ?? pid;
            return (
              <li key={pid}>
                <PluginIcon src={p?.icon} />
                <span className="plugin-main">
                  <span>
                    <strong>{title}</strong> {p?.forPlayers && forPlayers}
                  </span>
                  {runs && runsOn && p?.gameVersions && !runs.some((v) => p.gameVersions!.includes(v)) && (
                    <span className="error small">{format(all.plugins.noBuild, { version: runsOn })}</span>
                  )}
                  {p && (
                    <a className="small" href={pluginPage(p.slug, type)} target="_blank" rel="noreferrer">
                      {t.onModrinth} <ExternalLink size={12} aria-hidden />
                    </a>
                  )}
                </span>
                <RemovePluginButton id={server.id} pluginId={pid} title={title} t={t} />
              </li>
            );
          })}
          {included.length === 0 && server.plugins.length === 0 && <li className="muted">{t.none}</li>}
        </ul>
        <p className="muted small">
          {t.config} <Link href={`/dashboard/servers/${server.id}/files?path=${type === "mod" ? "config" : "plugins"}`}>{t.openConfig}</Link>
        </p>
      </section>

      {voice && (
        <section className="stack">
          <h2>{tv.title}</h2>
          <ul className="card plugin-list">
            <li>
              <span className="plugin-icon"><Mic size={20} aria-hidden /></span>
              <span className="plugin-main">
                <span>
                  <a href={pluginPage(VOICE_CHAT.slug, type)} target="_blank" rel="noreferrer">
                    <strong>{VOICE_CHAT.title}</strong>
                  </a>{" "}
                  {forPlayers}
                </span>
                <span className="muted small">{tv.intro}</span>
                {tv.steps.map((step, i) => (
                  <span key={step} className="small">
                    {i + 1}. {step}
                  </span>
                ))}
              </span>
              <AddPluginButton id={server.id} pluginId={VOICE_CHAT.id} added={server.plugins.includes(VOICE_CHAT.id)} t={t} />
            </li>
          </ul>
          <div className="address-card">
            <div>
              <p className="address-label">{tv.address}</p>
              <span className="address-value">
                {voice.host} <span className="muted">· {all.server.port}</span> {voice.port}
              </span>
            </div>
            <CopyButton text={`${voice.host}:${voice.port}`} label={all.server.copy} copiedLabel={all.server.copied} />
          </div>
          <p className="muted small">
            {tv.addressHint} {tv.oldServer}
          </p>
        </section>
      )}

      {sets.length > 0 && (
        <section className="stack">
          <h2>{t.sets}</h2>
          <p className="muted">{t.setsIntro}</p>
          <ul className="card plugin-list">
            {sets.map((set) => (
              <li key={set.id}>
                <span className="plugin-icon"><Package size={20} aria-hidden /></span>
                <span className="plugin-main">
                  <strong>{t.setNames[set.id]}</strong>
                  <span className="muted small">{t.setHints[set.id]}</span>
                  <span className="small">{set.plugins.map((p) => KNOWN_PLUGINS[p].title).join(" · ")}</span>
                </span>
                <AddSetButton
                  id={server.id}
                  setId={set.id}
                  added={pluginIds(set.plugins).every((p) => server.plugins.includes(p))}
                  t={t}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="stack" id="szukaj">
        <h2>{t.search}</h2>
        {sources.length > 0 && (
          <nav className="tabs">
            {sources.map((from) => (
              <Link key={from} className={from === active ? "active" : undefined} href={searchHref(from)}>
                {sourceNames[from]}
              </Link>
            ))}
          </nav>
        )}
        <form className="plugin-search" action={`/dashboard/servers/${server.id}/plugins#szukaj`}>
          {active && <input type="hidden" name="src" value={active} />}
          <input name="q" type="search" defaultValue={query} placeholder={t.searchPlaceholder} aria-label={t.search} maxLength={100} />
          <button>
            <Search size={16} aria-hidden /> {t.searchButton}
          </button>
        </form>
        <p className="muted small">
          {query ? format(t.results, { q: query }) : t.popular}
          {type === "mod" && ` · ${loader}`}
          {(fromCf ? mc : runsOn) && site !== "spigot" && ` · ${format(t.forVersion, { mc: (fromCf ? mc : runsOn)! })}`}
        </p>
        {site ? (
          <>
            <p className="muted small">{site === "hangar" ? t.hangarIntro : t.spigotIntro}</p>
            {siteResults === "siteUnavailable" ? (
              <p className="notice warn">{t.errors.siteUnavailable}</p>
            ) : !siteResults || siteResults.length === 0 ? (
              <p className="muted">{t.noResults}</p>
            ) : (
              <ul className="card plugin-list">
                {siteResults.map((p) => (
                  <li key={p.entry}>
                    <PluginIcon src={p.icon} />
                    <span className="plugin-main">
                      <a href={p.page} target="_blank" rel="noreferrer">
                        <strong>{p.title}</strong>
                      </a>
                      <span className="muted small">{p.description}</span>
                      <span className="muted small">
                        {format(t.downloads, { n: numbers.format(p.downloads) })}
                        {p.newestVersion && ` · ${format(t.upTo, { version: p.newestVersion })}`}
                      </span>
                      {p.blocked && <span className="small">{t.siteBlockedNote}</span>}
                    </span>
                    {!p.blocked && <AddPluginButton id={server.id} pluginId={p.entry} added={server.plugins.includes(p.entry)} t={t} />}
                  </li>
                ))}
              </ul>
            )}
            <h3>{t.siteAddLink}</h3>
            <AddWorkshopForm id={server.id} t={t} placeholder={site === "hangar" ? t.hangarLinkPlaceholder : t.spigotLinkPlaceholder} site="site" />
            <p className="muted small">
              {t.otherSites} <Link href={`/dashboard/servers/${server.id}/files?path=plugins`}>{t.openConfig}</Link>
            </p>
          </>
        ) : fromCf ? (
          cfResults === null ? (
            <p className="notice">{all.mods.errors.cfNeedsVersion}</p>
          ) : cfResults === "curseforgeUnavailable" ? (
            <p className="notice warn">{all.mods.errors.curseforgeUnavailable}</p>
          ) : (
            <>
              <p className="muted small">{format(all.mods.cfIntro, { loader, version: server.version })}</p>
              {cfResults.length === 0 ? (
                <p className="muted">{t.noResults}</p>
              ) : (
                <ul className="card plugin-list">
                  {cfResults.map((m) => (
                    <li key={m.modId}>
                      <PluginIcon src={m.icon} />
                      <span className="plugin-main">
                        <a href={curseforgeModPage(m.slug)} target="_blank" rel="noreferrer">
                          <strong>{m.title}</strong>
                        </a>
                        <span className="muted small">{m.description}</span>
                        <span className="muted small">{format(t.downloads, { n: numbers.format(m.downloads) })}</span>
                        {m.blocked && <span className="small">{all.mods.cfBlockedNote}</span>}
                      </span>
                      {!m.blocked && (
                        <AddPluginButton id={server.id} pluginId={`cf:${m.modId}`} added={hasCurseforgeMod(server.plugins, m.modId)} t={t} />
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <h3>{all.mods.cfAddLink}</h3>
              <AddWorkshopForm id={server.id} t={t} placeholder={all.mods.cfLinkPlaceholder} site="curseforge" />
            </>
          )
        ) : results === null ? null : results === "modrinthUnavailable" ? (
          <p className="notice warn">{t.errors.modrinthUnavailable}</p>
        ) : results.length === 0 ? (
          <p className="muted">{t.noResults}</p>
        ) : (
          <ul className="card plugin-list">
            {results.map((p) => (
              <li key={p.id}>
                <PluginIcon src={p.icon} />
                <span className="plugin-main">
                  <span>
                    <a href={pluginPage(p.slug, type)} target="_blank" rel="noreferrer">
                      <strong>{p.title}</strong>
                    </a>{" "}
                    {p.forPlayers && forPlayers}
                  </span>
                  <span className="muted small">{p.description}</span>
                  <span className="muted small">
                    {format(t.downloads, { n: numbers.format(p.downloads) })}
                    {p.newestVersion && ` · ${format(t.upTo, { version: p.newestVersion })}`}
                  </span>
                </span>
                <AddPluginButton id={server.id} pluginId={p.id} added={server.plugins.includes(p.id)} t={t} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PluginIcon({ src }: { src?: string }) {
  return (
    <span className="plugin-icon">
      {/* eslint-disable-next-line @next/next/no-img-element -- small icons through /api/plugin-icon */}
      {src ? <img src={src} alt="" width={40} height={40} loading="lazy" referrerPolicy="no-referrer" /> : <Puzzle size={20} aria-hidden />}
    </span>
  );
}
