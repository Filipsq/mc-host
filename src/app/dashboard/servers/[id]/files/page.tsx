import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getMessages, getPreferences } from "@/i18n/server";
import { getLiveDetails } from "@/lib/servers";
import { getServerFor } from "@/lib/access";
import { diskLimitMb, formatMb } from "@/lib/disk";
import { format } from "@/i18n/messages";
import { listFiles, type FileEntry } from "@/lib/agent";
import { canChangeFiles, EDIT_MAX_BYTES } from "@/lib/files";
import FileBrowser, { type FileRow } from "./FileBrowser";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ path?: string }> };

export default async function FilesPage({ params, searchParams }: Props) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const [{ id }, { path = "" }] = await Promise.all([params, searchParams]);
  const server = await getServerFor(id, session.user.id, "files");
  if (!server) notFound();

  const [all, { locale }, { live, agent }] = await Promise.all([getMessages(), getPreferences(), getLiveDetails(server)]);
  const t = all.files;
  const listing = server.status === "AWAITING_PAYMENT" ? null : await listFiles(server.id, path).catch((err) => err as Error);
  const dir = listing && !(listing instanceof Error) ? listing.path : "";
  const crumbs = dir && dir !== "." ? dir.split("/") : [];

  return (
    <main className="stack">
      <Link className="back" href={`/dashboard/servers/${server.id}`}>← {server.name}</Link>
      <h1>{t.title}</h1>
      {server.status === "AWAITING_PAYMENT" ? (
        <p className="notice">{t.notYet}</p>
      ) : !listing || listing instanceof Error ? (
        <>
          <p className="notice warn">{t.unavailable}</p>
          {path && <Link href={`/dashboard/servers/${server.id}/files`}>{t.top}</Link>}
        </>
      ) : (
        <>
          {!canChangeFiles(server) && <p className="notice warn">{t.readOnly}</p>}
          {(live === "online" || live === "starting") && dir === "." && <p className="notice">{t.runningWarn}</p>}
          <nav className="crumbs" aria-label={t.top}>
            <Link href={`/dashboard/servers/${server.id}/files`}>{t.top}</Link>
            {crumbs.map((part, i) => (
              <span key={i}>
                {" / "}
                {i === crumbs.length - 1 ? (
                  <strong>{part}</strong>
                ) : (
                  <Link href={`/dashboard/servers/${server.id}/files?path=${encodeURIComponent(crumbs.slice(0, i + 1).join("/"))}`}>
                    {part}
                  </Link>
                )}
              </span>
            ))}
          </nav>
          <FileBrowser
            id={server.id}
            dir={dir === "." ? "" : dir}
            rows={fileRows(listing.entries, dir, locale)}
            truncated={listing.truncated}
            canChange={canChangeFiles(server)}
            t={t}
          />
          <p className="muted small">
            {t.restartNote} {server.edition === "JAVA" && dir === "." && t.settingsNote}
          </p>
          {agent?.diskMb !== undefined && (
            <p className="muted small">
              {format(t.usage, { used: formatMb(agent.diskMb, locale), limit: formatMb(diskLimitMb(server.plan), locale) })}
            </p>
          )}
        </>
      )}
    </main>
  );
}

// Text files the editor opens; others can still be downloaded.
const TEXT = /\.(properties|ya?ml|json5?|txt|toml|cfg|conf|ini|log|md|sk|js|mcmeta|mcfunction|csv|xml|lang|sh|html?|css|secret)$/i;

function fileRows(entries: FileEntry[], dir: string, locale: string): FileRow[] {
  const dates = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Warsaw" });
  const units = ["byte", "kilobyte", "megabyte", "gigabyte"] as const;
  const size = (n: number) => {
    const i = Math.min(units.length - 1, Math.floor(Math.log(Math.max(n, 1)) / Math.log(1024)));
    return new Intl.NumberFormat(locale, { style: "unit", unit: units[i], unitDisplay: "short", maximumFractionDigits: 1 }).format(n / 1024 ** i);
  };
  return entries.map((e) => ({
    name: e.name,
    path: dir === "." ? e.name : `${dir}/${e.name}`,
    dir: e.type === "dir",
    file: e.type === "file",
    size: e.type === "file" ? size(e.size) : "",
    modified: dates.format(new Date(e.modified)),
    editable: e.type === "file" && e.size <= EDIT_MAX_BYTES && TEXT.test(e.name),
    zip: e.type === "file" && /\.zip$/i.test(e.name),
  }));
}
