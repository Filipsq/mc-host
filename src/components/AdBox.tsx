"use client";

import { useEffect, useState } from "react";
import { ADSENSE_CLIENT, ADSENSE_SLOT } from "@/lib/ads";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

// The side column only fits next to the panel on wide screens (globals.css .side-ad).
const SIDE_MEDIA = "(min-width: 1280px)";

type Props = {
  label: string;
  blockedLabel: string;
  // "side": a tall ad in the column right of a free server's panel, wide screens only.
  variant?: "wide" | "side";
};

// One AdSense unit with the admin's thank-you note above it, or a request to turn off an ad blocker.
export default function AdBox({ label, blockedLabel, variant = "wide" }: Props) {
  const side = variant === "side";
  const [blocked, setBlocked] = useState(false);
  // A unit with no room (hidden column) only makes AdSense complain, so the side one waits for a wide screen.
  const [show, setShow] = useState(!side);

  useEffect(() => {
    if (side) setShow(window.matchMedia(SIDE_MEDIA).matches);
  }, [side]);

  useEffect(() => {
    if (!show) return;
    // An ad blocker stops the request for AdSense's script; ask nicely instead of showing an empty box.
    fetch(`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`, {
      method: "HEAD",
      mode: "no-cors",
      cache: "no-store",
    }).catch(() => setBlocked(true));
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // Blocked by an ad blocker or no ad to show: the box just stays empty.
    }
  }, [show]);

  if (!show) return null;
  return (
    <aside className={`card stack-tight thanks-card${side ? " side" : ""}`}>
      <p className="muted small">{label}</p>
      {blocked && <p className="notice warn small">{blockedLabel}</p>}
      <ins
        className="adsbygoogle"
        style={{ display: "block" }}
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={ADSENSE_SLOT}
        data-ad-format={side ? "vertical" : "auto"}
        data-full-width-responsive={side ? "false" : "true"}
      />
    </aside>
  );
}
