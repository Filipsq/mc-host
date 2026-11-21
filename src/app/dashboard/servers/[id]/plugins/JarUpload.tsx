"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "@/i18n/messages";

type Texts = {
  jarTitle: string;
  jarIntro: string;
  jarPick: string;
  jarSubmit: string;
  jarUploading: string;
  jarDone: string;
  jarOnlyJar: string;
  jarFailed: string;
};

// The agent's per-file upload limit (UPLOAD_MAX_MB).
const MAX_FILE_MB = 1024;

/** A plugin or mod jar from the owner's computer, straight into plugins/ or mods/ through the file manager's upload. */
export default function JarUpload({ id, folder, intro, t }: { id: string; folder: "plugins" | "mods"; intro: string; t: Texts }) {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function send(f: File, name: string): Promise<boolean> {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", `/api/servers/${id}/files?path=${encodeURIComponent(`${folder}/${name}`)}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setProgress(format(t.jarUploading, { name, percent: Math.floor((e.loaded / e.total) * 100) }));
      };
      xhr.onload = () => resolve(xhr.status < 300);
      xhr.onerror = () => resolve(false);
      setProgress(format(t.jarUploading, { name, percent: 0 }));
      xhr.send(f);
    });
  }

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (progress || files.length === 0) return;
    // Only the file's own name, so nothing lands outside the folder.
    const named = files.map((f) => ({ f, name: f.name.split(/[\\/]/).pop()!.replace(/[^\w.+()\[\] -]/g, "_") }));
    if (named.some(({ f, name }) => !/\.jar$/i.test(name) || f.size > MAX_FILE_MB << 20)) return setMessage({ ok: false, text: t.jarOnlyJar });
    setMessage(null);
    let done = 0;
    for (const { f, name } of named) {
      if (!(await send(f, name))) {
        setProgress(null);
        return setMessage({ ok: false, text: format(t.jarFailed, { name }) });
      }
      done++;
    }
    setProgress(null);
    setFiles([]);
    (e.target as HTMLFormElement).reset();
    setMessage({ ok: true, text: format(t.jarDone, { n: done }) });
    router.refresh();
  }

  return (
    <form className="card stack" onSubmit={upload}>
      <h3>{t.jarTitle}</h3>
      <p className="muted small">{intro}</p>
      <label>
        {t.jarPick}
        <input type="file" accept=".jar" multiple required onChange={(e) => setFiles([...(e.target.files ?? [])])} />
      </label>
      {progress && (
        <p className="muted small" role="status">
          {progress}
        </p>
      )}
      {message && <p className={message.ok ? "notice" : "error"}>{message.text}</p>}
      <button type="submit" disabled={!!progress || files.length === 0}>
        {t.jarSubmit}
      </button>
    </form>
  );
}
