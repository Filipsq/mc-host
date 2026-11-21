"use client";

import { useState } from "react";
import { format, type Messages } from "@/i18n/messages";
import { PACK_HAND_MODS_DIR, PACK_UPLOAD_DIR } from "@/lib/modpacks";
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
  // How far the upload got (0-100), or null while the server works with no way to tell how far.
  const [percent, setPercent] = useState<number | null>(null);
  const [state, setState] = useState<UploadPackState & { tooBig?: boolean }>({});
  // The zip already uploaded, kept for the next try once the hand-downloaded mods are in.
  const [uploaded, setUploaded] = useState<string | null>(null);
  const [handNote, setHandNote] = useState<string | null>(null);

  function send(f: File, path: string): Promise<boolean> {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", `/api/servers/${id}/files?path=${encodeURIComponent(path)}`);
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const done = Math.floor((e.loaded / e.total) * 100);
        setPercent(done);
        setProgress(format(u.uploading, { percent: done }));
      };
      xhr.onload = () => resolve(xhr.status < 300);
      xhr.onerror = () => resolve(false);
      setPercent(0);
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
    setUploaded(path);
    await check(path);
  }

  async function check(path: string) {
    setPercent(null);
    setProgress(u.checking);
    // Success moves on to the server's page; only an error comes back.
    const result = await uploadPackAction(id, path, link);
    setProgress(null);
    if (result) setState(result);
  }

  /**
   * Files picked from the pack's folders in the CurseForge app (all of them is
   * fine): only the ones the pack still needs go up, then the pack is checked again.
   */
  async function sendHandMods(picked: File[]) {
    const needed = new Set((state.handMods ?? []).map((m) => m.fileName));
    const matching = picked.filter((f) => needed.has(f.name));
    if (!matching.length || !uploaded) return setHandNote(u.handNone);
    setHandNote(null);
    for (const f of matching) {
      if (!(await send(f, `${PACK_HAND_MODS_DIR}/${f.name}`))) {
        setProgress(null);
        return setState({ ...state, error: "failed" });
      }
    }
    setHandNote(format(u.handSent, { n: matching.length }));
    await check(uploaded);
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
        <div className="stack-tight" role="status">
          {/* No value: the bar keeps moving, so a long check doesn't look stuck. */}
          {percent === null ? <progress className="upload-progress" /> : <progress className="upload-progress" value={percent} max={100} />}
          <p className="muted small">{progress}</p>
          {percent === null && <p className="muted small">{u.checkingSlow}</p>}
        </div>
      )}
      {errorText && <p className="error">{errorText}</p>}
      {state.handMods && state.handMods.length > 0 && (
        <div className="notice warn stack-tight">
          <span>{u.handMods}</span>
          <ul className="small">
            {state.handMods.map((m) => (
              <li key={m.fileName}>
                {m.name} ({m.fileName})
              </li>
            ))}
          </ul>
          <span className="small">{state.handMods.every((m) => /\.zip$/i.test(m.fileName)) ? u.handPickHintPacks : u.handPickHint}</span>
          <label className="button small">
            {u.handPick}
            <input
              type="file"
              multiple
              hidden
              accept=".jar,.zip"
              disabled={!!progress}
              onChange={(e) => {
                const picked = [...(e.target.files ?? [])];
                e.target.value = "";
                void sendHandMods(picked);
              }}
            />
          </label>
        </div>
      )}
      {handNote && <p className="muted small">{handNote}</p>}
      <button type="submit" disabled={!!progress || !file}>
        {progress ? t.submitting : u.submit}
      </button>
    </form>
  );
}
