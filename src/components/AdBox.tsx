"use client";

import { useEffect, useState } from "react";
import { ADSENSE_CLIENT, ADSENSE_SLOT } from "@/lib/ads";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

// One AdSense unit with the admin's thank-you note above it, or a request to turn off an ad blocker.
export default function AdBox({ label, blockedLabel }: { label: string; blockedLabel: string }) {
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
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
  }, []);

  return (
    <aside className="card stack-tight thanks-card">
      <p className="muted small">{label}</p>
      {blocked && <p className="notice warn">{blockedLabel}</p>}
      <ins
        className="adsbygoogle"
        style={{ display: "block" }}
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={ADSENSE_SLOT}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </aside>
  );
}
