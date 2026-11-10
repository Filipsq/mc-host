"use client";

import { useEffect, useState } from "react";
import { Download, Save } from "lucide-react";
import type { FileError } from "@/lib/files";
import type { Messages } from "@/i18n/messages";

// nbt: the file is binary NBT shown as text; the site packs it back on save.
type Props = { id: string; path: string; initial: string; nbt?: { packing: string; root: string; version?: number }; readOnly: boolean; t: Messages["files"] };

export default function FileEditor({ id, path, initial, nbt, readOnly, t }: Props) {
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | FileError>("idle");
  const [detail, setDetail] = useState<string | null>(null);
  const dirty = text !== saved;
  const url = `/api/servers/${id}/files?path=${encodeURIComponent(path)}`;

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function save() {
    if (readOnly || status === "saving") return;
    setStatus("saving");
    const body = text;
    const target = nbt ? `${url}&nbt=${nbt.packing}&root=${encodeURIComponent(nbt.root)}${nbt.version !== undefined ? `&v=${nbt.version}` : ""}` : url;
    const res = await fetch(target, { method: "PUT", body }).catch(() => null);
    setDetail(null);
    if (res?.ok) {
      setSaved(body);
      setStatus("saved");
    } else {
      const data = await res?.json().catch(() => null);
      setStatus(data?.error && data.error in t.errors ? data.error : "failed");
      if (data?.error === "badNbt" && typeof data.detail === "string") {
        setDetail(data.line ? t.nbtLine.replace("{n}", String(data.line)) + " " + data.detail : data.detail);
      }
    }
  }

  return (
    <div className="stack">
      <textarea
        className="editor"
        value={text}
        readOnly={readOnly}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label={path}
        onChange={(e) => {
          setText(e.target.value);
          if (status !== "saving") setStatus("idle");
        }}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "s") {
            e.preventDefault();
            save();
          }
        }}
      />
      <div className="row">
        {!readOnly && (
          <button onClick={save} disabled={status === "saving" || !dirty}>
            <Save size={16} aria-hidden /> {status === "saving" ? t.saving : t.save}
          </button>
        )}
        <a className="button secondary" href={url} download>
          <Download size={16} aria-hidden /> {t.download}
        </a>
      </div>
      {status === "saved" && !dirty && <p className="notice success">{t.saved}</p>}
      {status !== "idle" && status !== "saving" && status !== "saved" && <p className="error">{t.errors[status]}{detail && ` ${detail}`}</p>}
    </div>
  );
}
