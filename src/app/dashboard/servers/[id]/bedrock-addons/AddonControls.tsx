"use client";

import { useState, useTransition } from "react";
import { Trash2, Upload } from "lucide-react";
import { format, type Messages } from "@/i18n/messages";
import { ADDON_FILE_TYPES, ADDON_UPLOAD_DIR } from "@/lib/bedrockAddons";
import { installAddonAction, removeAddonAction, type AddonError } from "./actions";

type T = Messages["bedrockAddons"];
type FileErrors = Messages["files"]["errors"];

function errorText(t: T, files: FileErrors, error: AddonError) {
  return (t.errors as Record<string, string>)[error] ?? (files as Record<string, string>)[error] ?? files.failed;
}

/** Uploads a .mcaddon/.mcpack and has it unpacked and turned on in one go. */
export function UploadAddon({ id, t, files }: { id: string; t: T; files: FileErrors }) {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<AddonError | null>(null);

  function send(f: File, path: string): Promise<AddonError | null> {
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
    if (!file || progress) return;
    const ext = ADDON_FILE_TYPES.find((x) => file.name.toLowerCase().endsWith(x));
    if (!ext) return setError("wrongFile");
    setError(null);
    const random = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const path = `${ADDON_UPLOAD_DIR}/${random}${ext}`;
    const sent = await send(file, path);
    if (sent) {
      setProgress(null);
      return setError(sent);
    }
    setProgress(t.unpacking);
    const result = await installAddonAction(id, path);
    // Success moves on to the list; only an error comes back.
    setProgress(null);
    if (result?.error) setError(result.error);
  }

  return (
    <form className="stack" onSubmit={upload}>
      <label>
        {t.file}
        <input type="file" accept={ADDON_FILE_TYPES.join(",")} required onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      {progress && (
        <p className="muted small" role="status">
          {progress}
        </p>
      )}
      {error && <p className="error">{errorText(t, files, error)}</p>}
      <button type="submit" disabled={!!progress || !file}>
        <Upload size={16} aria-hidden /> {t.upload}
      </button>
    </form>
  );
}

export function RemoveAddonButton({ id, uuid, name, t, files }: { id: string; uuid: string; name: string; t: T; files: FileErrors }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<AddonError | null>(null);
  return (
    <>
      <button
        type="button"
        className="secondary small"
        disabled={pending}
        onClick={() => {
          if (!confirm(format(t.removeConfirm, { name }))) return;
          setError(null);
          start(async () => {
            const result = await removeAddonAction(id, uuid);
            if (result?.error) setError(result.error);
          });
        }}
      >
        <Trash2 size={14} aria-hidden /> {t.remove}
      </button>
      {error && <span className="error small">{errorText(t, files, error)}</span>}
    </>
  );
}
