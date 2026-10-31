"use client";

import { startTransition, useActionState, useState, useTransition } from "react";
import { Play, Trash2, Upload } from "lucide-react";
import { format, type Messages } from "@/i18n/messages";
import { WORLD_UPLOAD_DIR, isValidWorldName, worldNameFromFile, type WorldType } from "@/lib/worlds";
import { formatMb } from "@/lib/disk";
import { deleteWorldAction, importWorldAction, newWorldAction, switchWorldAction, type WorldError } from "./actions";

type T = Messages["worlds"];
type FileErrors = Messages["files"]["errors"];
type Props = { id: string; t: T; files: FileErrors };

function errorText(t: T, files: FileErrors, error: WorldError) {
  return (t.errors as Record<string, string>)[error] ?? (files as Record<string, string>)[error] ?? files.failed;
}

/** A button that runs a world action after a confirmation, showing what went wrong. */
function WorldButton({
  label,
  icon,
  className,
  question,
  run,
  t,
  files,
}: {
  label: string;
  icon: React.ReactNode;
  className: string;
  question: string;
  run: () => Promise<{ error?: WorldError }>;
  t: T;
  files: FileErrors;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<WorldError | null>(null);
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={pending}
        onClick={() => {
          if (!confirm(question)) return;
          setError(null);
          start(async () => {
            const result = await run();
            if (result?.error) setError(result.error);
          });
        }}
      >
        {icon} {label}
      </button>
      {error && <span className="error small">{errorText(t, files, error)}</span>}
    </>
  );
}

export function PlayWorldButton({ id, name, t, files }: Props & { name: string }) {
  return (
    <WorldButton
      label={t.play}
      icon={<Play size={14} aria-hidden />}
      className="secondary small"
      question={format(t.playConfirm, { name })}
      run={() => switchWorldAction(id, name)}
      t={t}
      files={files}
    />
  );
}

export function DeleteWorldButton({ id, name, t, files }: Props & { name: string }) {
  return (
    <WorldButton
      label={t.delete}
      icon={<Trash2 size={14} aria-hidden />}
      className="danger small"
      question={format(t.deleteConfirm, { name })}
      run={() => deleteWorldAction(id, name)}
      t={t}
      files={files}
    />
  );
}

export function NewWorldForm({
  id,
  initialName,
  types,
  versions,
  version,
  latest,
  t,
  files,
}: Props & { initialName: string; types: readonly WorldType[]; versions: string[]; version: string; latest: string }) {
  const [state, action, pending] = useActionState(newWorldAction.bind(null, id), {});
  const v = state.values ?? {};
  return (
    <form
      className="stack"
      // `action` only serves a submit made before the page's script has loaded.
      action={action}
      onSubmit={(e) => {
        // Submitted by hand, so the fields keep what was typed after an error.
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <label>
        {t.name}
        <input name="name" required maxLength={32} defaultValue={v.name ?? initialName} />
      </label>
      <label>
        {t.seed}
        <input name="seed" maxLength={32} defaultValue={v.seed} autoComplete="off" />
        <span className="muted small">{t.seedHint}</span>
      </label>
      {types.length > 1 && (
        <label>
          {t.type}
          <select name="type" defaultValue={v.type ?? "normal"}>
            {types.map((type) => (
              <option key={type} value={type}>
                {t.types[type]}
              </option>
            ))}
          </select>
        </label>
      )}
      {versions.length > 1 && (
        <label>
          {t.version}
          <select name="version" defaultValue={v.version ?? version}>
            {versions.map((ver) => (
              <option key={ver} value={ver}>
                {ver === "LATEST" ? latest : ver}
              </option>
            ))}
          </select>
          <span className="muted small">{t.versionHint}</span>
        </label>
      )}
      {state.error && <p className="error">{errorText(t, files, state.error)}</p>}
      <button type="submit" disabled={pending}>
        {pending ? t.creating : t.create}
      </button>
    </form>
  );
}

/** A way to get more disk space: `mb` is the server's whole space with it. */
export type MoreSpace = { label: string; mb: number; href: string };

// The agent's per-file upload limit (UPLOAD_MAX_MB).
const MAX_FILE_MB = 1024;
// A zipped world unpacks to at least its own size, and the zip stays until it's unpacked.
const NEEDS_TIMES = 2;

/** Why a world zip won't fit, before it's sent: nobody waits for a big upload just to be told no. */
function noRoom(f: File, space: { usedMb: number; limitMb: number } | null, more: MoreSpace[]) {
  const fileMb = Math.ceil(f.size / 1024 / 1024);
  if (fileMb > MAX_FILE_MB) return { fileMb, tooBig: true as const };
  if (!space) return null;
  const needMb = fileMb * NEEDS_TIMES;
  const freeMb = Math.max(0, space.limitMb - space.usedMb);
  if (needMb <= freeMb) return null;
  return { fileMb, needMb, freeMb, fix: more.find((m) => m.mb - space.usedMb >= needMb) };
}

/** A world zip goes up through the file manager's upload, then the server unpacks it into a world. */
export function UploadWorld({
  id,
  bedrock,
  t,
  files,
  space,
  more,
  locale,
}: Props & { bedrock: boolean; space: { usedMb: number; limitMb: number } | null; more: MoreSpace[]; locale: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [play, setPlay] = useState(true);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<WorldError | null>(null);

  function send(f: File, path: string): Promise<WorldError | null> {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", `/api/servers/${id}/files?path=${encodeURIComponent(path)}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(format(t.uploading, { percent: Math.floor((e.loaded / e.total) * 100) }));
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
      setProgress(format(t.uploading, { percent: 0 }));
      xhr.send(f);
    });
  }

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || progress || full) return;
    const world = name.trim();
    if (!isValidWorldName(world)) return setError("invalidName");
    setError(null);
    const random = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const path = `${WORLD_UPLOAD_DIR}/${random}.zip`;
    const sent = await send(file, path);
    if (sent) {
      setProgress(null);
      return setError(sent);
    }
    setProgress(t.unpacking);
    const result = await importWorldAction(id, path, world, play);
    // Success moves on to the list; only an error comes back.
    setProgress(null);
    if (result?.error) setError(result.error);
  }

  const full = file ? noRoom(file, space, more) : null;
  const mb = (n: number) => formatMb(n, locale);

  return (
    <form className="stack" onSubmit={upload}>
      <label>
        {bedrock ? t.fileBedrock : t.file}
        <input
          type="file"
          accept={bedrock ? ".mcworld,.zip" : ".zip"}
          required
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            if (f && !name) setName(worldNameFromFile(f.name));
          }}
        />
      </label>
      <label>
        {t.name}
        <input name="name" required maxLength={32} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={play} onChange={(e) => setPlay(e.target.checked)} />
        <span>{t.playNow}</span>
      </label>
      {progress && (
        <p className="muted small" role="status">
          {progress}
        </p>
      )}
      {full && (
        <div className="notice warn stack-tight" role="alert">
          {full.tooBig ? (
            <span>{format(t.space.tooBig, { size: mb(full.fileMb), max: mb(MAX_FILE_MB) })}</span>
          ) : (
            <>
              <span>{format(t.space.noRoom, { size: mb(full.fileMb), need: mb(full.needMb), free: mb(full.freeMb), limit: mb(space!.limitMb) })}</span>
              {full.fix ? (
                <span className="row">
                  <span>{format(t.space.fix, { plan: full.fix.label, more: mb(full.fix.mb) })}</span>
                  <a className="button small" href={full.fix.href}>{format(t.getMore, { plan: full.fix.label })}</a>
                </span>
              ) : (
                <span>{t.space.cleanUp}</span>
              )}
            </>
          )}
        </div>
      )}
      {error && <p className="error">{errorText(t, files, error)}</p>}
      <button type="submit" disabled={!!progress || !file || !!full}>
        <Upload size={16} aria-hidden /> {t.upload}
      </button>
    </form>
  );
}
