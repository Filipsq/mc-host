import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Image as ImageIcon, Puzzle } from "lucide-react";
import { getSession } from "@/lib/session";
import { getMessages } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { getServerFor } from "@/lib/access";
import { listBedrockPacks } from "@/lib/agent";
import { onHost } from "@/lib/servers";
import { canChangeFiles } from "@/lib/files";
import { activeLevel } from "@/lib/worlds";
import { takesBedrockAddons } from "@/lib/bedrockAddons";
import { RemoveAddonButton, UploadAddon } from "./AddonControls";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ added?: string; removed?: string }> };

/**
 * Bedrock add-ons: the owner uploads a .mcaddon or .mcpack and the agent puts
 * its packs where the server looks and turns them on in the world it runs.
 */
export default async function BedrockAddonsPage({ params, searchParams }: Props) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const [{ id }, done] = await Promise.all([params, searchParams]);
  const server = await getServerFor(id, session.user.id, "files");
  if (!server || !takesBedrockAddons(server)) notFound();
  const all = await getMessages();
  const t = all.bedrockAddons;
  const world = activeLevel(server);
  const ready = onHost(server) && canChangeFiles(server);
  const packs = ready ? await listBedrockPacks(server.id, world).catch(() => null) : null;

  return (
    <div className="wide-form stack">
      <h2>{t.title}</h2>
      <p className="muted">{t.intro}</p>
      {done.added && <p className="notice success" role="status">{format(t.added, { names: done.added })}</p>}
      {done.removed && <p className="notice success" role="status">{t.removed}</p>}

      <section className="card stack">
        <h3>{t.howTitle}</h3>
        <ol className="stack-tight" style={{ listStyle: "decimal", paddingLeft: "1.25rem" }}>
          {t.howSteps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
        <p className="muted small">{t.notHere}</p>
      </section>

      {!ready ? (
        <p className="notice">{t.notOnHost}</p>
      ) : (
        <>
          <section className="stack">
            <h3>{t.uploadTitle}</h3>
            <UploadAddon id={server.id} t={t} files={all.files.errors} />
          </section>
          <section className="stack">
            <h3>{format(t.installed, { world })}</h3>
            {packs === null ? (
              <p className="notice warn">{t.unavailable}</p>
            ) : (
              <ul className="card plugin-list">
                {packs.map((p) => (
                  <li key={p.uuid}>
                    <span className="plugin-icon">{p.type === "resource" ? <ImageIcon size={20} aria-hidden /> : <Puzzle size={20} aria-hidden />}</span>
                    <span className="plugin-main">
                      <strong>{p.name}</strong>
                      <span className="muted small">
                        {p.type === "resource" ? t.resource : t.behavior}
                        {p.version?.length ? ` · ${p.version.join(".")}` : ""}
                      </span>
                      {p.beta && <span className="notice warn small">{t.beta}</span>}
                    </span>
                    <RemoveAddonButton id={server.id} uuid={p.uuid} name={p.name} t={t} files={all.files.errors} />
                  </li>
                ))}
                {packs.length === 0 && <li className="muted">{t.none}</li>}
              </ul>
            )}
            <p className="muted small">
              {t.restart} <Link href={`/dashboard/servers/${server.id}/files?path=behavior_packs`}>{t.openFiles}</Link>
            </p>
          </section>
        </>
      )}
    </div>
  );
}
