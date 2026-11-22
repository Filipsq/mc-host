"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CornerLeftUp,
  Download,
  File,
  FilePlus,
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
  zipError?: FileError; // a zip of ticked files that couldn't start (the page opened again with it)
  t: Messages["files"];
};

export default function FileBrowser({ id, dir, rows, truncated, canChange, zipError, t }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(
    zipError ? { text: `${t.zipFailed} ${t.errors[zipError] ?? t.errors.failed}`, error: true } : null,
  );
  const [zipping, setZipping] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [creating, setCreating] = useState<"folder" | "file" | null>(null);
  const [dragging, setDragging] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const picker = useRef<HTMLInputElement>(null);

  const base = `/dashboard/servers/${id}/files`;
  const inDir = (name: string) => (dir ? `${dir}/${name}` : name);
  const open = (path: string) => `${base}?path=${encodeURIComponent(path)}`;
  const edit = (path: string) => `${base}/edit?path=${encodeURIComponent(path)}`;
  const download = (path: string) => `/api/servers/${id}/files?path=${encodeURIComponent(path)}`;
  const busy = pending || progress !== null;

  // The error is shown once: refreshing the page shouldn't bring it back.
  useEffect(() => {
    if (!zipError) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("zip");
    window.history.replaceState(null, "", url);
  }, [zipError]);

  // Only rows still in this folder count (after a delete or moving to another folder).
  const selected = rows.filter((r) => picked.has(r.path));
  const allPicked = rows.length > 0 && selected.length === rows.length;
  const toggle = (path: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (!next.delete(path)) next.add(path);
      return next;
    });

  function removeSelected() {
    const folders = selected.filter((r) => r.dir).length;
    const text = format(folders ? t.deleteManyFoldersConfirm : t.deleteManyConfirm, { n: selected.length, folders });
    if (!confirm(text)) return;
    setMessage(null);
    startTransition(async () => {
      const res = await fileAction(id, { removeMany: selected.map((r) => r.path) });
      setPicked(new Set());
      const n = res.files ?? 0;
      if (res.error) setMessage({ text: `${format(t.deletedMany, { n })} ${t.errors[res.error]}`, error: true });
      else setMessage({ text: format(t.deletedMany, { n }), error: false });
    });
  }

  // One file comes as it is; more, or a folder, as one zip the browser saves as it's made.
  function downloadSelected() {
    setMessage(null);
    if (selected.length === 1 && selected[0].file) {
      const a = document.createElement("a");
      a.href = download(selected[0].path);
      a.download = selected[0].name;
      a.click();
      return;
    }
    const form = document.createElement("form");
    form.method = "POST";
    form.action = `/api/servers/${id}/files/zip`;
    form.hidden = true;
    for (const [name, value] of [
      ["dir", dir],
      ["paths", JSON.stringify(selected.map((r) => r.path))],
    ]) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.append(input);
    }
    document.body.append(form);
    form.submit();
    form.remove();
    setMessage({ text: t.zipStarted, error: false });
    // Against a double click starting two downloads.
    setZipping(true);
    setTimeout(() => setZipping(false), 4000);
  }

  function run(op: FileOp, done?: (files?: number) => string) {
    setMessage(null);
    startTransition(async () => {
      const res = await fileAction(id, op);
      if (res.error) {
        setMessage({ text: t.errors[res.error], error: true });
        return;
      }
      setRenaming(null);
      setCreating(null);
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
          <button className="secondary" disabled={busy} onClick={() => setCreating("file")}>
            <FilePlus size={16} aria-hidden /> {t.newFile}
          </button>
          <button className="secondary" disabled={busy} onClick={() => setCreating("folder")}>
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
            if (!name) return;
            if (creating === "folder") return run({ mkdir: inDir(name) });
            const path = inDir(name);
            setMessage(null);
            startTransition(async () => {
              const res = await fileAction(id, { newFile: path });
              if (res.error) return setMessage({ text: t.errors[res.error], error: true });
              router.push(edit(path));
            });
          }}
        >
          <input
            key={creating}
            name="name"
            required
            autoFocus
            maxLength={255}
            aria-label={creating === "file" ? t.fileName : t.folderName}
            placeholder={creating === "file" ? t.fileName : t.folderName}
          />
          <button disabled={pending}>{t.create}</button>
          <button type="button" className="secondary" onClick={() => setCreating(null)}>
            {t.cancel}
          </button>
          {creating === "file" && <span className="muted small">{t.newFileHint}</span>}
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
        {rows.length > 0 && (
          <div className="file-select-bar">
            <label className="file-check">
              <input
                type="checkbox"
                checked={allPicked}
                ref={(el) => {
                  if (el) el.indeterminate = selected.length > 0 && !allPicked;
                }}
                onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map((r) => r.path)))}
              />
              {t.selectAll}
            </label>
            {selected.length > 0 && (
              <>
                <span className="muted small">{format(t.selectedCount, { n: selected.length })}</span>
                <button
                  className="secondary small"
                  disabled={busy || zipping}
                  onClick={downloadSelected}
                  title={selected.length === 1 && selected[0].file ? undefined : t.downloadSelectedHint}
                >
                  <Download size={15} aria-hidden /> {t.downloadSelected}
                </button>
                {canChange && (
                  <button className="danger small" disabled={busy} onClick={removeSelected}>
                    <Trash2 size={15} aria-hidden /> {t.deleteSelected}
                  </button>
                )}
                <button className="secondary small" disabled={busy} onClick={() => setPicked(new Set())}>
                  {t.clearSelection}
                </button>
              </>
            )}
          </div>
        )}
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
              <li key={r.path} className={picked.has(r.path) ? "picked" : undefined}>
                <input
                  type="checkbox"
                  className="file-pick"
                  checked={picked.has(r.path)}
                  onChange={() => toggle(r.path)}
                  aria-label={format(t.selectOne, { name: r.name })}
                />
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
