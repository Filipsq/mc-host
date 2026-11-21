"use client";

import { useState } from "react";
import { format, type Messages } from "@/i18n/messages";
import { PACK_UPLOAD_DIR } from "@/lib/modpacks";
import { uploadPackAction, type UploadPackState } from "./actions";

// The agent's per-file upload limit (UPLOAD_MAX_MB).
const MAX_FILE_MB = 1024;

type Props = { id: string; t: Messages["serverType"]; server: Messages["server"] };

/**
 * A CurseForge pack whose authors allow downloads only on CurseForge: the owner
 * downloads its ZIP there and uploads it through the file manager's upload; the
 * server then checks it against the link and switches the server to it.
 */
export default function UploadPack({ id, t, server }: Props) {
  const u = t.uploadPack;
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [progress, setProgress] = useState<string | null>(null);
  const [state, setState] = useState<UploadPackState & { tooBig?: boolean }>({});

  function send(f: File, path: string): Promise<boolean> {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", `/api/servers/${id}/files?path=${encodeURIComponent(path)}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(format(u.uploading, { percent: Math.floor((e.loaded / e.total) * 100) }));
      };
      xhr.onload = () => resolve(xhr.status < 300);
      xhr.onerror = () => resolve(false);
      setProgress(format(u.uploading, { percent: 0 }));
      xhr.send(f);
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || progress) return;
    if (file.size > MAX_FILE_MB << 20) return setState({ tooBig: true });
    if (!confirm(u.confirm)) return;
    setState({});
    const random = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const path = `${PACK_UPLOAD_DIR}/upload-${random}.zip`;
    if (!(await send(file, path))) {
      setProgress(null);
      return setState({ error: "failed" });
    }
    setProgress(u.checking);
    // Success moves on to the server's page; only an error comes back.
    const result = await uploadPackAction(id, path, link);
    setProgress(null);
    if (result) setState(result);
  }

  const errorText = state.tooBig
    ? u.errors.tooBig
    : state.error &&
      ((u.errors as Record<string, string>)[state.error] ??
        (t.errors as Record<string, string>)[state.error] ??
        (server.errors as Record<string, string>)[state.error] ??
        t.errors.failed);

  return (
    <form className="card stack" onSubmit={submit}>
      <h3>{u.title}</h3>
      <p className="muted">{u.intro}</p>
      <label>
        {u.link}
        <input
          type="url"
          required
          maxLength={300}
          placeholder="https://www.curseforge.com/minecraft/modpacks/..."
          value={link}
          onChange={(e) => setLink(e.target.value)}
        />
      </label>
      <label>
        {u.file}
        <input type="file" accept=".zip" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <p className="muted small">{u.players}</p>
      {progress && (
        <p className="muted small" role="status">
          {progress}
        </p>
      )}
      {errorText && <p className="error">{errorText}</p>}
      {state.handMods && state.handMods.length > 0 && (
        <div className="notice warn stack-tight">
          <span>{u.handMods}</span>
          <ul className="small">
            {state.handMods.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}
      <button type="submit" disabled={!!progress || !file}>
        {progress ? t.submitting : u.submit}
      </button>
    </form>
  );
}
