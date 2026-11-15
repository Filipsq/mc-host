"use client";

import { useEffect } from "react";
import { ADSENSE_CLIENT, ADSENSE_SLOT } from "@/lib/ads";

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

// One AdSense unit with the admin's thank-you note above it.
export default function AdBox({ label }: { label: string }) {
  useEffect(() => {
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      // Blocked by an ad blocker or no ad to show: the box just stays empty.
    }
  }, []);

  return (
    <aside className="card stack-tight thanks-card">
      <p className="muted small">{label}</p>
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
