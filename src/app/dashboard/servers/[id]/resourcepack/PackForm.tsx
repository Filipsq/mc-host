"use client";

import { startTransition, useActionState, useTransition, useState } from "react";
import { removePackAction, savePackAction, type PackState } from "./actions";
import { PACK_PROMPT_MAX } from "@/lib/settings";
import { format, type Messages } from "@/i18n/messages";

type Props = {
  serverId: string;
  initial: { url: string; uploaded: boolean; required: boolean; prompt: string };
  maxBytes: number;
  running: boolean; // saving restarts it
  t: Messages["resourcePack"];
};

type UploadError = NonNullable<PackState["error"]>;

/** Sends the .zip into the server's files, with progress; the save that follows checks it. */
function sendPack(serverId: string, file: File, onProgress: (percent: number) => void): Promise<UploadError | null> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/servers/${serverId}/resourcepack`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.floor((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status < 300) return resolve(null);
      try {
        resolve(JSON.parse(xhr.responseText).error ?? "uploadFailed");
      } catch {
        resolve(xhr.status === 413 ? "tooBig" : "uploadFailed");
      }
    };
    xhr.onerror = () => resolve("uploadFailed");
    onProgress(0);
    xhr.send(file);
  });
}

export default function PackForm({ serverId, initial, maxBytes, running, t }: Props) {
  const [state, action, pending] = useActionState(savePackAction.bind(null, serverId), {});
  const [removed, setRemoved] = useState<PackState>({});
  const [removing, startRemove] = useTransition();
  const has = initial.url !== "" && !removed.removed;
  // A new pack starts with uploading a file; a saved link stays a link.
  const [source, setSource] = useState<"upload" | "link">(has && !initial.uploaded ? "link" : "upload");
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<UploadError | null>(null);
  const hasUploaded = has && initial.uploaded;
  const result: PackState = uploadError ? { error: uploadError } : removed.removed || removed.error ? removed : state;
  const busy = pending || removing || progress !== null;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const data = new FormData(e.currentTarget);
    setUploadError(null);
    setRemoved({});
    if (source === "upload") {
      if (!file && !hasUploaded) return setUploadError("noFile");
      if (file) {
        if (!file.name.toLowerCase().endsWith(".zip")) return setUploadError("notZip");
        if (file.size > maxBytes) return setUploadError("tooBig");
        const failed = await sendPack(serverId, file, setProgress);
        setProgress(null);
        if (failed) return setUploadError(failed);
      }
    }
    data.delete("file");
    startTransition(() => action(data));
  }

  return (
    <form onSubmit={submit} className="card stack">
      <input type="hidden" name="source" value={source} />
      <div className="row">
        <label className="check">
          <input type="radio" name="sourcePick" checked={source === "upload"} onChange={() => setSource("upload")} />
          <span>{t.sourceUpload}</span>
        </label>
        <label className="check">
          <input type="radio" name="sourcePick" checked={source === "link"} onChange={() => setSource("link")} />
          <span>{t.sourceLink}</span>
        </label>
      </div>
      {source === "upload" ? (
        <label>
          {t.file}
          <input name="file" type="file" accept=".zip,application/zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <span className="muted small">{hasUploaded ? t.fileHintSaved : t.fileHint}</span>
        </label>
      ) : (
        <label>
          {t.url}
          <input
            name="url"
            type="url"
            required
            placeholder="https://www.dropbox.com/…/paczka.zip?dl=1"
            defaultValue={has && !initial.uploaded ? initial.url : ""}
          />
          <span className="muted small">{t.urlHint}</span>
        </label>
      )}
      <label className="check">
        <input name="required" type="checkbox" defaultChecked={has && initial.required} />
        <span className="stack-tight">
          <span>{t.required}</span>
          <span className="muted small">{t.requiredHint}</span>
        </span>
      </label>
      <label>
        {t.prompt}
        <input name="prompt" maxLength={PACK_PROMPT_MAX} placeholder={t.promptPlaceholder} defaultValue={has ? initial.prompt : ""} />
        <span className="muted small">{t.promptHint}</span>
      </label>
      {running && <p className="notice warn small">{t.restartNote}</p>}
      {progress !== null && <p className="muted small">{format(t.uploading, { percent: progress })}</p>}
      {pending && <p className="muted small">{t.checking}</p>}
      {!busy && result.saved && <p className="notice small">{t.saved}</p>}
      {!busy && result.removed && <p className="notice small">{t.removed}</p>}
      {!busy && result.error && <p className="error">{t.errors[result.error]}</p>}
      <div className="row">
        <button type="submit" disabled={busy}>
          {progress !== null ? format(t.uploading, { percent: progress }) : pending ? t.checking : t.save}
        </button>
        {has && (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => startRemove(async () => setRemoved(await removePackAction(serverId)))}
          >
            {t.remove}
          </button>
        )}
      </div>
    </form>
  );
}
