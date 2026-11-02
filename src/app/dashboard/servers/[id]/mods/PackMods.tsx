import Link from "next/link";
import { Search } from "lucide-react";
import type { Server } from "@prisma/client";
import { getMessages } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { listFiles } from "@/lib/agent";

const LOADERS: Record<string, string> = { fabric: "Fabric", forge: "Forge", neoforge: "NeoForge", quilt: "Quilt" };

/** The mods a mod pack installed (its mods folder), with a way to add one more jar through Files. */
export default async function PackMods({ server, q }: { server: Server; q: string }) {
  const all = await getMessages();
  const t = all.packMods;
  const query = q.trim().slice(0, 100);
  const listing = server.status === "AWAITING_PAYMENT" ? null : await listFiles(server.id, "mods").catch(() => "error" as const);
  const jars =
    listing && listing !== "error"
      ? listing.entries
          .filter((e) => e.type === "file" && e.name.toLowerCase().endsWith(".jar"))
          .map((e) => e.name.slice(0, -4))
          .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
      : [];
  const shown = query ? jars.filter((j) => j.toLowerCase().includes(query.toLowerCase())) : jars;
  const pack = server.modpackTitle ?? server.modpack ?? "";
  const loader = LOADERS[server.modpackLoader ?? ""] ?? "Fabric";

  return (
    <div className="stack">
      <h2>{all.mods.title}</h2>
      {listing === null ? (
        <p className="notice">{t.notYet}</p>
      ) : listing === "error" ? (
        <p className="notice warn">{t.unavailable}</p>
      ) : jars.length === 0 ? (
        <p className="notice">{t.notYet}</p>
      ) : (
        <>
          <p className="muted">{format(t.intro, { pack, n: String(jars.length) })}</p>
          <form className="plugin-search" action={`/dashboard/servers/${server.id}/mods`}>
            <input name="q" type="search" defaultValue={query} placeholder={t.filter} aria-label={t.filter} maxLength={100} />
            <button>
              <Search size={16} aria-hidden /> {t.filterButton}
            </button>
          </form>
          {query && <p className="muted small">{format(t.shown, { q: query, n: String(shown.length) })}</p>}
          {shown.length === 0 ? (
            <p className="muted">{t.none}</p>
          ) : (
            <ul className="card stack-tight small">
              {shown.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          )}
          <p className="muted small">{t.removeHint}</p>
        </>
      )}
      <div className="card stack-tight">
        <strong>{t.addTitle}</strong>
        <span className="muted small">{format(t.addText, { loader, version: server.version })}</span>
        <Link className="button secondary" href={`/dashboard/servers/${server.id}/files?path=mods`}>
          {t.addButton}
        </Link>
      </div>
    </div>
  );
}
