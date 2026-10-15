"use client";

import { useEffect } from "react";

/** Registers public/sw.js, which makes the site installable and shows notifications. */
export default function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => console.warn("[sw] registration failed:", err));
  }, []);
  return null;
}
