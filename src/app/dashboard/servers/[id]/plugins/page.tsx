import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ExternalLink, Package, Puzzle, Search } from "lucide-react";
import { getSession } from "@/lib/session";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { getServerFor } from "@/lib/access";
import { getPluginInfos, searchAddons } from "@/lib/modrinth";
import { GAME_MODE_PLUGINS, KNOWN_PLUGINS, PLUGIN_SETS, addonType, pluginIds, pluginPage, setFits } from "@/lib/plugins";
import { LOADER_NAMES, isServerKind } from "@/lib/modpacks";
import { AddPluginButton, AddSetButton, ApplyPlugins, RemovePluginButton } from "./PluginButtons";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string }> };

export default async function PluginsPage({ params, searchParams }: Props) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const [{ id }, { q = "" }] = await Promise.all([params, searchParams]);
  const server = await getServerFor(id, session.user.id, "plugins");
  if (!server) notFound();
  const [all, { locale }] = await Promise.all([getMessages(), getPreferences()]);
  const type = addonType(server);
  // Mod servers use the same page with mod wording.
  const t = type === "mod" ? { ...all.plugins, ...all.mods } : all.plugins;
  const back = <Link className="back" href={`/dashboard/servers/${server.id}`}>← {server.name}</Link>;

  if (!type) {
    return (
      <main className="wide-form stack">
        {back}
        <h1>{t.title}</h1>
        <p className="notice">{server.edition === "BEDROCK" ? t.notBedrock : t.notModpack}</p>
      </main>
    );
  }

  const query = q.trim().slice(0, 100);
  // Servers on a chosen version only see what's made for it; game modes run the newest version.
  const mc = (server.kind === "vanilla" || type === "mod") && server.version !== "LATEST" ? server.version : undefined;
  const [infos, results] = await Promise.all([
    getPluginInfos(server.plugins),
    searchAddons(type, query, { gameVersion: mc, loader: server.kind }),
  ]);
  const kind = isServerKind(server.kind) ? server.kind : "vanilla";
  const included = GAME_MODE_PLUGINS[kind] ?? [];
  const numbers = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
  const sets = type === "plugin" ? PLUGIN_SETS.filter((set) => setFits(set, kind)) : [];
  const loader = LOADER_NAMES[server.kind] ?? server.kind;
  const forPlayers = <span className="chip small-chip">{all.mods.forPlayers}</span>;
  // Names for plugins from the sets, in case Modrinth doesn't answer.
  const knownTitle = (pid: string) => Object.values(KNOWN_PLUGINS).find((p) => p.id === pid)?.title;

  return (
    <main className="stack">
      {back}
      <h1>{t.title}</h1>
      <p className="muted">
        {type === "mod" ? format(all.mods.introMods, { loader, version: server.version === "LATEST" ? all.settings.latest : server.version }) : t.intro}
      </p>
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
            const p = infos.get(pid);
            const title = p?.title ?? knownTitle(pid) ?? pid;
            return (
              <li key={pid}>
                <PluginIcon src={p?.icon} />
                <span className="plugin-main">
                  <span>
                    <strong>{title}</strong> {p?.forPlayers && forPlayers}
                  </span>
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

      <section className="stack">
        <h2>{t.search}</h2>
        <form className="plugin-search" action={`/dashboard/servers/${server.id}/plugins`}>
          <input name="q" type="search" defaultValue={query} placeholder={t.searchPlaceholder} aria-label={t.search} maxLength={100} />
          <button>
            <Search size={16} aria-hidden /> {t.searchButton}
          </button>
        </form>
        <p className="muted small">
          {query ? format(t.results, { q: query }) : t.popular}
          {type === "mod" && ` · ${loader}`}
          {mc && ` · ${format(t.forVersion, { mc })}`}
        </p>
        {results === "modrinthUnavailable" ? (
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
    </main>
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
