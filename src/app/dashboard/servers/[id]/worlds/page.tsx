import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Download, Globe } from "lucide-react";
import { getSession } from "@/lib/session";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { getServerFor } from "@/lib/access";
import { listWorlds } from "@/lib/agent";
import { onHost } from "@/lib/servers";
import { canChangeFiles } from "@/lib/files";
import { formatMb } from "@/lib/disk";
import { activeLevel, nextWorldName, worldTypes } from "@/lib/worlds";
import { DeleteWorldButton, NewWorldForm, PlayWorldButton, UploadWorld } from "./WorldControls";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ switched?: string; uploaded?: string; deleted?: string }> };

export default async function WorldsPage({ params, searchParams }: Props) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const [{ id }, done] = await Promise.all([params, searchParams]);
  const server = await getServerFor(id, session.user.id, "files");
  // Minecraft worlds only; a Terraria server's world is in its files.
  if (!server || server.edition === "TERRARIA") notFound();
  const [all, { locale }] = await Promise.all([getMessages(), getPreferences()]);
  const t = all.worlds;
  const back = <Link className="back" href={`/dashboard/servers/${server.id}`}>← {server.name}</Link>;

  // Unpaid servers aren't on the game host yet; suspended ones are, but only for downloads.
  const listing = server.status === "AWAITING_PAYMENT" || server.status === "PROVISIONING" ? null : await listWorlds(server.id, server.edition).catch(() => "unavailable" as const);
  if (!listing || listing === "unavailable") {
    return (
      <main className="wide-form stack">
        {back}
        <h1>{t.title}</h1>
        <p className={listing ? "notice warn" : "notice"}>{listing ? t.errors.unavailable : t.errors.notOnHost}</p>
      </main>
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
    <main className="wide-form stack">
      {back}
      <header className="stack-tight">
        <h1>{t.title}</h1>
        <p className="muted">{t.intro}</p>
      </header>
      {notice && <p className="notice">{notice}</p>}
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
              t={t}
              files={all.files.errors}
            />
          </section>
          <section className="card stack">
            <h2>{t.uploadTitle}</h2>
            <p className="muted">{java ? t.uploadIntro : t.uploadIntroBedrock}</p>
            <UploadWorld key={formKey} id={server.id} bedrock={!java} t={t} files={all.files.errors} />
          </section>
        </>
      )}
    </main>
  );
}
