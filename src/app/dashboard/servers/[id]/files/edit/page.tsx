import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getMessages } from "@/i18n/server";
import { getOwnedServer } from "@/lib/servers";
import { AgentError, openFile } from "@/lib/agent";
import { canChangeFiles, EDIT_MAX_BYTES } from "@/lib/files";
import FileEditor from "./FileEditor";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ path?: string }> };

export default async function EditFilePage({ params, searchParams }: Props) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const [{ id }, { path = "" }] = await Promise.all([params, searchParams]);
  const server = await getOwnedServer(id, session.user.id);
  if (!server || !path) notFound();
  const t = (await getMessages()).files;

  const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const back = `/dashboard/servers/${server.id}/files${folder ? `?path=${encodeURIComponent(folder)}` : ""}`;
  const text = await readText(server.id, path);

  return (
    <main className="stack">
      <Link className="back" href={back}>← {t.title}</Link>
      <div>
        <p className="muted small">{t.editing}</p>
        <h1 className="file-title">{path.split("/").at(-1)}</h1>
        {folder && <p className="muted small mono">{path}</p>}
      </div>
      {text === "notFound" ? (
        <p className="notice warn">{t.errors.notFound}</p>
      ) : text === "failed" ? (
        <p className="notice warn">{t.unavailable}</p>
      ) : text === "notText" ? (
        <>
          <p className="notice">{t.notText}</p>
          <a className="button secondary" href={`/api/servers/${server.id}/files?path=${encodeURIComponent(path)}`} download>
            {t.download}
          </a>
        </>
      ) : (
        <>
          {!canChangeFiles(server) && <p className="notice warn">{t.readOnly}</p>}
          <FileEditor id={server.id} path={path} initial={text.content} readOnly={!canChangeFiles(server)} t={t} />
        </>
      )}
    </main>
  );
}

/** The file as text, or why it can't be edited here. */
async function readText(id: string, path: string) {
  try {
    const res = await openFile(id, path, { max: EDIT_MAX_BYTES });
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.includes(0)) return "notText" as const;
    return { content: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch (err) {
    if (err instanceof TypeError) return "notText" as const; // not UTF-8
    if (err instanceof AgentError) {
      if (err.status === 404) return "notFound" as const;
      if (err.status === 413 || err.status === 400) return "notText" as const;
    }
    console.error("open file failed", id, path, err);
    return "failed" as const;
  }
}
