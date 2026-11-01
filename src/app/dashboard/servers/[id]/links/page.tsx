import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getMessages } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { getServerFor } from "@/lib/access";
import { db } from "@/lib/db";
import { javaHost } from "@/lib/servers";
import { LINKS_MAX, canLink, linkName } from "@/lib/links";
import LinksForm from "./LinksForm";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ done?: string }> };

// Linking the owner's Java servers so players move between them in the game (src/lib/links.ts).
export default async function LinksPage({ params, searchParams }: Props) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const [{ id }, { done }] = await Promise.all([params, searchParams]);
  const server = await getServerFor(id, session.user.id, "owner");
  if (!server || server.edition !== "JAVA") notFound();
  const t = (await getMessages()).links;
  const others = await db.server.findMany({
    where: { ownerId: server.ownerId, edition: "JAVA", id: { not: server.id } },
    orderBy: { createdAt: "asc" },
  });
  const linked = server.linkGroup ? others.filter((o) => o.linkGroup === server.linkGroup) : [];

  return (
    <div className="wide-form stack">
      <h2>{t.title}</h2>
      <p className="muted">{t.intro}</p>
      {done === "saved" && <p className="notice">{t.saved}</p>}
      {done === "failed" && <p className="error">{t.failed}</p>}
      {!canLink(server) ? (
        <p className="notice warn">{t.tooOld}</p>
      ) : others.length === 0 ? (
        <p className="notice">{t.noOthers}</p>
      ) : (
        <LinksForm
          serverId={server.id}
          servers={others.map((o) => ({
            id: o.id,
            name: o.name,
            address: javaHost(o),
            ok: canLink(o),
            checked: linked.some((l) => l.id === o.id),
            elsewhere: !!o.linkGroup && o.linkGroup !== server.linkGroup,
          }))}
          max={LINKS_MAX - 1}
          t={t}
        />
      )}
      {linked.length > 0 && (
        <section className="card stack">
          <h2 className="card-title">{t.howTitle}</h2>
          <p>{t.howText}</p>
          <ul className="stack-tight">
            {linked.map((l) => (
              <li key={l.id}>
                <code>/trigger {linkName(l)}</code> {format(t.goesTo, { name: l.name })}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="card stack">
        <h2 className="card-title">{t.notesTitle}</h2>
        <ul className="stack-tight">
          {t.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
