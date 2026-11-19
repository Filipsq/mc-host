import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FolderOpen } from "lucide-react";
import { getSession } from "@/lib/session";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { getServerFor } from "@/lib/access";
import { diskUsage, listWorlds, previewTrim } from "@/lib/agent";
import { getLiveDetailsOnce, onHost } from "@/lib/servers";
import { canChangeFiles } from "@/lib/files";
import { formatMb } from "@/lib/disk";
import { backupsFor } from "@/lib/addons";
import { activeLevel, canTrim, isKnownWorldName, TRIM_MAX_RADIUS, worldBorderCommands } from "@/lib/worlds";
import { TrimForm } from "./TrimForm";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ world?: string; x?: string; z?: string; done?: string; backup?: string }> };

const coord = (v: string | undefined) => {
  const n = Math.trunc(Number(v) || 0);
  return Math.abs(n) <= TRIM_MAX_RADIUS ? n : 0;
};

export default async function TrimPage({ params, searchParams }: Props) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const [{ id }, q] = await Promise.all([params, searchParams]);
  const server = await getServerFor(id, session.user.id, "files");
  if (!server || server.edition !== "JAVA") notFound();
  const [all, { locale }] = await Promise.all([getMessages(), getPreferences()]);
  const t = all.worlds.trim;
  const mb = (bytes: number) => formatMb(Math.max(bytes > 0 ? 1 : 0, Math.round(bytes / 1024 / 1024)), locale);
  const num = new Intl.NumberFormat(locale);

  if (!canTrim(server)) {
    return (
      <div className="wide-form stack">
        <h2>{t.title}</h2>
        <p className="notice">{t.javaOnly}</p>
      </div>
    );
  }
  if (!onHost(server) || !canChangeFiles(server)) {
    return (
      <div className="wide-form stack">
        <h2>{t.title}</h2>
        <p className="notice">{server.status === "SUSPENDED" ? all.files.errors.readOnly : all.worlds.errors.notOnHost}</p>
      </div>
    );
  }

  const x = coord(q.x);
  const z = coord(q.z);
  const listing = await listWorlds(server.id, server.edition).catch(() => null);
  const worlds = listing?.worlds ?? [];
  const active = activeLevel(server);
  const name = q.world && isKnownWorldName(q.world) && worlds.some((w) => w.name === q.world) ? q.world : active;
  const [preview, usage, { live }] = await Promise.all([
    worlds.some((w) => w.name === name) ? previewTrim(server.id, name, { x, z }).catch(() => null) : null,
    diskUsage(server.id).catch(() => null),
    getLiveDetailsOnce(server.id, server.status),
  ]);
  const running = live === "online" || live === "starting" || live === "restarting";
  const done = q.done?.match(/^(\d+)\.(\d+)\.(\d+)$/);
  const doneRadius = done ? Number(done[3]) : 0;
  const biggest = usage?.entries[0]?.size ?? 0;

  return (
    <div className="wide-form stack">
      <header className="stack-tight">
        <p className="muted small">
          <Link href={`/dashboard/servers/${server.id}/worlds`}>{all.worlds.title}</Link>
        </p>
        <h2>{t.title}</h2>
        <p className="muted">{t.intro}</p>
      </header>

      {done && (
        <div className="notice stack-tight">
          <span>{format(t.done, { files: num.format(Number(done[1])), size: mb(Number(done[2])) })}</span>
          {q.backup && <span>{t.doneBackup}</span>}
        </div>
      )}
      {(done || (preview && preview.reach > 20_000)) && (
        <section className="card stack">
          <h2>{t.borderTitle}</h2>
          <p className="muted">{t.borderIntro}</p>
          <pre className="code-block">
            {worldBorderCommands(x, z, doneRadius || preview?.cuts.find((c) => c.bytes > 0)?.radius || 10_000).join("\n")}
          </pre>
          <p className="muted small">{t.borderWhy}</p>
        </section>
      )}

      {worlds.length > 1 && (
        <nav className="row wrap" aria-label={t.world}>
          {worlds.map((w) => (
            <Link
              key={w.name}
              className={`button small ${w.name === name ? "" : "secondary"}`}
              href={`/dashboard/servers/${server.id}/worlds/trim?${new URLSearchParams({ world: w.name, x: String(x), z: String(z) })}`}
            >
              {w.name}
            </Link>
          ))}
        </nav>
      )}

      {!preview ? (
        <p className="notice warn">{t.unavailable}</p>
      ) : preview.files === 0 ? (
        <p className="notice">{t.empty}</p>
      ) : (
        <section className="card stack">
          <p>{format(t.summary, { name, size: mb(preview.bytes), reach: num.format(preview.reach) })}</p>
          <ul className="stack-tight">
            {preview.dimensions.map((d) => (
              <li key={d.dimension} className="muted small">
                <strong>{t.dimensions[d.dimension] ?? d.dimension}</strong>: {format(t.dimensionLine, { size: mb(d.bytes), reach: num.format(d.reach) })}
              </li>
            ))}
          </ul>
          {running && <p className="notice warn">{t.stopFirst}</p>}
          <TrimForm
            key={`${name}/${x}/${z}/${q.done ?? ""}`}
            id={server.id}
            world={name}
            x={x}
            z={z}
            cuts={preview.cuts.map((c) => ({ radius: c.radius, label: format(t.keep, { radius: num.format(c.radius) }), frees: c.bytes > 0 ? format(t.frees, { size: mb(c.bytes) }) : t.nothing, bytes: c.bytes }))}
            backups={backupsFor(server) > 0}
            disabled={running}
            t={t}
            errors={all.worlds.errors}
            files={all.files.errors}
          />
          <details>
            <summary>{t.centerTitle}</summary>
            <form className="stack" method="get">
              <p className="muted small">{t.centerIntro}</p>
              <input type="hidden" name="world" value={name} />
              <div className="row wrap">
                <label>
                  X
                  <input name="x" type="number" defaultValue={x} min={-TRIM_MAX_RADIUS} max={TRIM_MAX_RADIUS} step={1} />
                </label>
                <label>
                  Z
                  <input name="z" type="number" defaultValue={z} min={-TRIM_MAX_RADIUS} max={TRIM_MAX_RADIUS} step={1} />
                </label>
              </div>
              <button type="submit" className="secondary small">
                {t.recalc}
              </button>
            </form>
          </details>
        </section>
      )}

      {usage && usage.entries.length > 0 && (
        <section className="card stack">
          <h2>{t.usageTitle}</h2>
          <p className="muted">{t.usageIntro}</p>
          <ul className="stack-tight">
            {usage.entries.slice(0, 10).map((e) => (
              <li key={e.name} className="stack-tight">
                <span className="row">
                  <span>
                    {e.type === "dir" ? <FolderOpen size={14} aria-hidden /> : null} {e.name}
                  </span>
                  <span className="muted small">{mb(e.size)}</span>
                </span>
                <span className="meter">
                  <span style={{ width: `${biggest ? Math.max(1, Math.round((e.size / biggest) * 100)) : 0}%` }} />
                </span>
              </li>
            ))}
          </ul>
          <p className="row">
            <span className="muted small">{format(t.usageTotal, { size: mb(usage.total) })}</span>
            <Link className="button secondary small" href={`/dashboard/servers/${server.id}/files`}>
              {t.openFiles}
            </Link>
          </p>
        </section>
      )}
    </div>
  );
}
