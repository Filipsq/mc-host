"use client";

import { useState } from "react";
import { Download, Share2 } from "lucide-react";

type Props = { image: string; file: string; title: string; t: { download: string; share: string; shareFailed: string } };

/** Save the picture, or on a phone hand it straight to TikTok, Instagram or Discord. */
export default function ShareSummary({ image, file, title, t }: Props) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const canShare = typeof navigator !== "undefined" && "canShare" in navigator;

  const share = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const blob = await (await fetch(image)).blob();
      const png = new File([blob], file, { type: "image/png" });
      if (navigator.canShare?.({ files: [png] })) await navigator.share({ files: [png], title });
      else window.location.href = `${image}&download=1`;
    } catch (err) {
      if ((err as Error).name !== "AbortError") setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="row-inline">
      <a className="button" href={`${image}&download=1`} download={file}>
        <Download size={18} aria-hidden /> {t.download}
      </a>
      {canShare && (
        <button type="button" className="secondary" onClick={share} disabled={busy} aria-busy={busy}>
          <Share2 size={18} aria-hidden /> {t.share}
        </button>
      )}
      {failed && <span className="error small">{t.shareFailed}</span>}
    </div>
  );
}
