"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CornerLeftUp,
  Download,
  File,
  FileArchive,
  FileText,
  Folder,
  FolderPlus,
  PackageOpen,
  Pencil,
  TextCursorInput,
  Trash2,
  Upload,
} from "lucide-react";
import { fileAction, type FileOp } from "./actions";
import type { FileError } from "@/lib/files";
import type { Messages } from "@/i18n/messages";
import { format } from "@/i18n/messages";

// Sizes and dates come formatted from the server, like the backups list.
export type FileRow = {
  name: string;
  path: string;
  dir: boolean;
  file: boolean; // a regular file (not a folder or a link)
  size: string;
  modified: string;
  editable: boolean;
  zip: boolean;
};

type Props = {
  id: string;
  dir: string; // "" is the top folder
  rows: FileRow[];
  truncated: boolean;
  canChange: boolean; // false while suspended: downloads only
  t: Messages["files"];
};

export default function FileBrowser({ id, dir, rows, truncated, canChange, t }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const base = `/dashboard/servers/${id}/files`;
  const inDir = (name: string) => (dir ? `${dir}/${name}` : name);
  const open = (path: string) => `${base}?path=${encodeURIComponent(path)}`;
  const edit = (path: string) => `${base}/edit?path=${encodeURIComponent(path)}`;
  const download = (path: string) => `/api/servers/${id}/files?path=${encodeURIComponent(path)}`;
  const busy = pending || progress !== null;

  function run(op: FileOp, done?: (files?: number) => string) {
    setMessage(null);
    startTransition(async () => {
      const res = await fileAction(id, op);
      if (res.error) {
        setMessage({ text: t.errors[res.error], error: true });
        return;
      }
      setRenaming(null);
      setCreating(false);
      if (done) setMessage({ text: done(res.files), error: false });
    });
  }

  // One file at a time, with progress: worlds and mod files can be big.
  function send(file: globalThis.File): Promise<FileError | null> {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", download(inDir(file.name)));
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setProgress(format(t.uploading, { name: file.name, percent: Math.floor((e.loaded / e.total) * 100) }));
        }
      };
      xhr.onload = () => {
        if (xhr.status < 300) return resolve(null);
        try {
          resolve(JSON.parse(xhr.responseText).error ?? "failed");
        } catch {
          resolve(xhr.status === 413 ? "tooBig" : "failed");
        }
      };
      xhr.onerror = () => resolve("failed");
      setProgress(format(t.uploading, { name: file.name, percent: 0 }));
      xhr.send(file);
    });
  }

  async function upload(files: globalThis.File[]) {
    if (!canChange || busy || files.length === 0) return;
    setMessage(null);
    const existing = new Set(rows.map((r) => r.name));
    let sent = 0;
    for (const file of files) {
      if (existing.has(file.name) && !confirm(format(t.replaceConfirm, { name: file.name }))) continue;
      const error = await send(file);
      if (error) {
        setMessage({ text: t.errors[error] ?? t.errors.failed, error: true });
        break;
      }
      sent++;
    }
    setProgress(null);
    if (sent > 0) {
      setMessage((m) => m ?? { text: t.uploaded, error: false });
      router.refresh();
    }
  }

  return (
    <div className="stack">
      {canChange && (
        <div className="row file-toolbar">
          <button className="secondary" disabled={busy} onClick={() => picker.current?.click()}>
            <Upload size={16} aria-hidden /> {t.upload}
          </button>
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              upload([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
          <button className="secondary" disabled={busy} onClick={() => setCreating(true)}>
            <FolderPlus size={16} aria-hidden /> {t.newFolder}
          </button>
        </div>
      )}
      {creating && (
        <form
          className="file-form"
          onSubmit={(e) => {
            e.preventDefault();
            const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
            if (name) run({ mkdir: inDir(name) });
          }}
        >
          <input name="name" required autoFocus maxLength={255} aria-label={t.folderName} placeholder={t.folderName} />
          <button disabled={pending}>{t.create}</button>
          <button type="button" className="secondary" onClick={() => setCreating(false)}>
            {t.cancel}
          </button>
        </form>
      )}
      {progress && <p className="muted small">{progress}</p>}
      {message && <p className={message.error ? "error" : "notice success"}>{message.text}</p>}

      <div
        className={`card file-card${dragging ? " dragging" : ""}`}
        onDragOver={(e) => {
          if (!canChange) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          if (!canChange) return;
          e.preventDefault();
          setDragging(false);
          upload([...e.dataTransfer.files]);
        }}
      >
        <ul className="file-list">
          {dir && (
            <li>
              <Link className="file-name" href={dir.includes("/") ? open(dir.slice(0, dir.lastIndexOf("/"))) : base}>
                <CornerLeftUp size={18} aria-hidden /> {t.up}
              </Link>
            </li>
          )}
          {rows.length === 0 && <li className="muted">{t.empty}</li>}
          {rows.map((r) =>
            renaming === r.path ? (
              <li key={r.path}>
                <form
                  className="file-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const to = String(new FormData(e.currentTarget).get("to") ?? "").trim();
                    // A bare name stays in this folder; a path starts from the top folder.
                    if (to && to !== r.name) run({ rename: r.path, to: to.includes("/") ? to.replace(/^\/+/, "") : inDir(to) });
                    else setRenaming(null);
                  }}
                >
                  <input name="to" defaultValue={r.name} required autoFocus maxLength={1024} aria-label={t.newName} />
                  <button className="small" disabled={pending}>
                    {t.save}
                  </button>
                  <button type="button" className="secondary small" onClick={() => setRenaming(null)}>
                    {t.cancel}
                  </button>
                  <span className="muted small">{t.renameHint}</span>
                </form>
              </li>
            ) : (
              <li key={r.path}>
                <span className="file-name">
                  {r.dir ? (
                    <Folder size={18} aria-hidden className="file-icon dir" />
                  ) : r.zip ? (
                    <FileArchive size={18} aria-hidden className="file-icon" />
                  ) : r.editable ? (
                    <FileText size={18} aria-hidden className="file-icon" />
                  ) : (
                    <File size={18} aria-hidden className="file-icon" />
                  )}
                  {r.dir ? (
                    <Link href={open(r.path)}>{r.name}</Link>
                  ) : r.editable ? (
                    <Link href={edit(r.path)}>{r.name}</Link>
                  ) : (
                    <span>{r.name}</span>
                  )}
                </span>
                <span className="file-meta muted small">
                  {r.size && `${r.size} · `}
                  {r.modified}
                </span>
                <span className="file-actions">
                  {r.file && (
                    <a className="button secondary small" href={download(r.path)} download title={t.download} aria-label={`${t.download}: ${r.name}`}>
                      <Download size={15} aria-hidden />
                    </a>
                  )}
                  {canChange && r.editable && (
                    <Link className="button secondary small" href={edit(r.path)} title={t.edit} aria-label={`${t.edit}: ${r.name}`}>
                      <Pencil size={15} aria-hidden />
                    </Link>
                  )}
                  {canChange && r.zip && (
                    <button
                      className="secondary small"
                      disabled={busy}
                      title={t.unzip}
                      aria-label={`${t.unzip}: ${r.name}`}
                      onClick={() => {
                        if (confirm(format(t.unzipConfirm, { name: r.name }))) {
                          run({ unzip: r.path }, (n) => format(t.unzipped, { n: n ?? 0 }));
                        }
                      }}
                    >
                      <PackageOpen size={15} aria-hidden />
                    </button>
                  )}
                  {canChange && (
                    <button
                      className="secondary small"
                      disabled={busy}
                      title={t.rename}
                      aria-label={`${t.rename}: ${r.name}`}
                      onClick={() => setRenaming(r.path)}
                    >
                      <TextCursorInput size={15} aria-hidden />
                    </button>
                  )}
                  {canChange && (
                    <button
                      className="secondary small"
                      disabled={busy}
                      title={t.delete}
                      aria-label={`${t.delete}: ${r.name}`}
                      onClick={() => {
                        if (confirm(format(r.dir ? t.deleteFolderConfirm : t.deleteConfirm, { name: r.name }))) run({ remove: r.path });
                      }}
                    >
                      <Trash2 size={15} aria-hidden />
                    </button>
                  )}
                </span>
              </li>
            ),
          )}
        </ul>
        {truncated && <p className="muted small">{t.truncated}</p>}
      </div>
      {canChange && <p className="muted small">{t.dropHint}</p>}
    </div>
  );
}
