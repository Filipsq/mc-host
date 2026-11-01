import { notFound, redirect } from "next/navigation";
import { Download, Globe } from "lucide-react";
import { getSession } from "@/lib/session";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { getServerFor } from "@/lib/access";
import { listWorlds } from "@/lib/agent";
import { getLiveDetailsOnce, onHost } from "@/lib/servers";
import { canChangeFiles } from "@/lib/files";
import { diskLimitMb, formatMb } from "@/lib/disk";
import { planById } from "@/lib/plans";
import { biggerPlans, canUpgrade } from "@/lib/upgrade";
import { serverAddons } from "@/lib/addons";
import { activeLevel, newWorldVersions, nextWorldName, worldTypes } from "@/lib/worlds";
import { DeleteWorldButton, NewWorldForm, PlayWorldButton, UploadWorld, type MoreSpace } from "./WorldControls";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ switched?: string; uploaded?: string; deleted?: string; dropped?: string }> };

export default async function WorldsPage({ params, searchParams }: Props) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const [{ id }, done] = await Promise.all([params, searchParams]);
  const server = await getServerFor(id, session.user.id, "files");
  // Minecraft worlds only; a Terraria server's world is in its files.
  if (!server || server.edition === "TERRARIA") notFound();
  const [all, { locale }, { agent }] = await Promise.all([getMessages(), getPreferences(), getLiveDetailsOnce(server.id, server.status)]);
  const t = all.worlds;

  // Unpaid servers aren't on the game host yet; suspended ones are, but only for downloads.
  const listing = server.status === "AWAITING_PAYMENT" || server.status === "PROVISIONING" ? null : await listWorlds(server.id, server.edition).catch(() => "unavailable" as const);
  if (!listing || listing === "unavailable") {
    return (
      <div className="wide-form stack">
        <h2>{t.title}</h2>
        <p className={listing ? "notice warn" : "notice"}>{listing ? t.errors.unavailable : t.errors.notOnHost}</p>
      </div>
    );
  }

  const active = activeLevel(server);
  const canChange = onHost(server) && canChangeFiles(server);
  // Islands live in the game mode's own worlds, so the server's world isn't the owner's to swap.
  const gameMode = server.kind === "skyblock" || server.kind === "oneblock";
  const worlds = [...listing.worlds].sort((a, b) => Number(b.name === active) - Number(a.name === active));
  const made = worlds.some((w) => w.name === active);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const java = server.edition === "JAVA";
  // Room for an upload, as the agent last measured, and the ways to get more:
  // a paid plan for a free server, a bigger plan or the disk add-on for a paid one.
  const limitMb = diskLimitMb(server);
  const space = agent?.diskMb === undefined ? null : { usedMb: agent.diskMb, limitMb };
  const planMb = planById(server.plan).diskGb * 1024;
  const more: MoreSpace[] = (
    server.plan === "FREE"
      ? biggerPlans("FREE").map((p) => ({ label: all.plans[p.id], mb: p.diskGb * 1024, href: `/dashboard/servers/${server.id}/billing?plan=${p.id}` }))
      : [
          ...(canUpgrade(server)
            ? biggerPlans(server.plan).map((p) => ({ label: all.plans[p.id], mb: limitMb - planMb + p.diskGb * 1024, href: `/dashboard/servers/${server.id}/upgrade` }))
            : []),
          ...(serverAddons(server).includes("disk") ? [] : [{ label: all.paidAddons.names.disk, mb: limitMb + 10 * 1024, href: `/dashboard/servers/${server.id}/addons` }]),
        ]
  ).sort((a, b) => a.mb - b.mb);
  // The actions come back to this page, so the forms start over once the worlds change.
  const formKey = [active, ...worlds.map((w) => w.name)].join("/");
  const notice = done.switched
    ? format(t.switched, { name: done.switched })
    : done.uploaded
      ? format(t.uploaded, { name: done.uploaded })
      : done.deleted
        ? t.deleted
        : null;

  return (
    <div className="wide-form stack">
      <header className="stack-tight">
        <h2>{t.title}</h2>
        <p className="muted">{t.intro}</p>
      </header>
      {notice && <p className="notice">{notice}</p>}
      {done.switched && done.dropped && <p className="notice warn">{format(all.plugins.droppedOnVersion, { list: done.dropped.slice(0, 300) })}</p>}
      {!canChange && server.status === "SUSPENDED" && <p className="notice warn">{all.files.errors.readOnly}</p>}

      <section className="stack">
        <ul className="card plugin-list world-list">
          {!made && (
            <li>
              <span className="plugin-icon"><Globe size={20} aria-hidden /></span>
              <span className="plugin-main">
                <span>
                  <strong>{active}</strong> <span className="chip small-chip">{t.active}</span>
                </span>
                <span className="muted small">{worlds.length === 0 ? t.none : t.notMadeYet}</span>
                {server.levelSeed && (
                  <span className="muted small">
                    {t.seed}: <code>{server.levelSeed}</code>
                  </span>
                )}
              </span>
            </li>
          )}
          {worlds.map((w) => (
            <li key={w.name}>
              <span className="plugin-icon"><Globe size={20} aria-hidden /></span>
              <span className="plugin-main">
                <span>
                  <strong>{w.name}</strong> {w.name === active && <span className="chip small-chip">{t.active}</span>}
                </span>
                <span className="muted small">
                  {format(t.meta, { size: formatMb(Math.max(1, Math.round(w.size / 1024 / 1024)), locale), date: date.format(new Date(w.modified)) })}
                </span>
              </span>
              <span className="world-actions">
                <a
                  className="button secondary small"
                  href={`/api/servers/${server.id}/worlds?name=${encodeURIComponent(w.name)}`}
                  download
                >
                  <Download size={14} aria-hidden /> {t.download}
                </a>
                {canChange && !gameMode && w.name !== active && <PlayWorldButton id={server.id} name={w.name} t={t} files={all.files.errors} />}
                {canChange && w.name !== active && <DeleteWorldButton id={server.id} name={w.name} t={t} files={all.files.errors} />}
              </span>
            </li>
          ))}
        </ul>
        <p className="muted small">{java ? t.downloadHint : t.downloadHintBedrock}</p>
        {gameMode && <p className="muted small">{t.gameModeNote}</p>}
      </section>

      {canChange && !gameMode && (
        <>
          <section className="card stack">
            <h2>{t.newTitle}</h2>
            <p className="muted">{t.newIntro}</p>
            <NewWorldForm
              key={formKey}
              id={server.id}
              initialName={nextWorldName([...worlds.map((w) => w.name), active])}
              types={worldTypes(server.edition)}
              versions={newWorldVersions(server)}
              version={server.version}
              latest={all.settings.latest}
              t={t}
              files={all.files.errors}
            />
          </section>
          <section className="card stack">
            <h2>{t.uploadTitle}</h2>
            <p className="muted">{java ? t.uploadIntro : t.uploadIntroBedrock}</p>
            {server.plan === "FREE" && space && more[0] && (
              <div className="notice row">
                <span>{format(t.freeSpace, { limit: formatMb(limitMb, locale), used: formatMb(space.usedMb, locale), plan: more[0].label, more: formatMb(more[0].mb, locale) })}</span>
                <a className="button small" href={more[0].href}>{format(t.getMore, { plan: more[0].label })}</a>
              </div>
            )}
            <UploadWorld key={formKey} id={server.id} bedrock={!java} t={t} files={all.files.errors} space={space} more={more} locale={locale} />
          </section>
        </>
      )}
    </div>
  );
}
