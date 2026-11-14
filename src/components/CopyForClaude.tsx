"use client";

import { useState } from "react";
import { ClipboardCopy } from "lucide-react";
import type { Messages } from "@/i18n/messages";
import { copyText } from "@/lib/copyText";
import { claudeContextAction } from "@/app/admin/claudeActions";

type State = "idle" | "copying" | "copied" | "failed";

/** Admins only: copies everything about a chat or a server, to paste into Claude. */
export default function CopyForClaude({ target, t }: { target: { userId: string } | { serverId: string }; t: Messages["admin"]["copyForClaude"] }) {
  const [state, setState] = useState<State>("idle");
  const [fallback, setFallback] = useState<string | null>(null);

  const copy = async () => {
    setState("copying");
    setFallback(null);
    const load = claudeContextAction(target);
    // Safari only lets a page write the clipboard during the click itself, so the
    // text that's still loading goes in as a promise there.
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": load.then((text) => {
              if (!text) throw new Error("empty");
              return new Blob([text], { type: "text/plain" });
            }),
          }),
        ]);
        setState("copied");
        return;
      } catch {
        // Not allowed here: try the plain way below.
      }
    }
    const text = await load.catch(() => null);
    if (text && (await copyText(text))) return setState("copied");
    setFallback(text);
    setState("failed");
  };

  return (
    <div className="stack-tight">
      <div>
        <button type="button" className="secondary small" onClick={copy} disabled={state === "copying"} title={t.hint}>
          <ClipboardCopy size={16} aria-hidden /> {state === "copying" ? t.copying : state === "copied" ? t.copied : t.button}
        </button>
      </div>
      {state === "failed" && <p className="error small">{fallback ? t.selectBelow : t.failed}</p>}
      {fallback && <textarea readOnly value={fallback} rows={8} onFocus={(e) => e.currentTarget.select()} />}
    </div>
  );
}
