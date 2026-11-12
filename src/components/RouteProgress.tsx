"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * A thin green bar along the top of the page from the moment a link inside the
 * site is clicked until the new page is there, so a click never looks ignored
 * while the server (and the game machine behind it) answers.
 */
export default function RouteProgress() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // A click on a link to another page of the site starts the bar.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return; // same page or #anchor
      clearTimeout(timer.current);
      setState("loading");
      // Never stuck: a link that ends up on the same page (a redirect back) lets go after a while.
      timer.current = setTimeout(() => setState("idle"), 12_000);
    };
    // Capture phase: next/link calls preventDefault on its own click, after this runs.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // The new page is there: finish the bar and fade it out.
  useEffect(() => {
    setState((s) => (s === "loading" ? "done" : s));
    timer.current = setTimeout(() => setState("idle"), 350);
    return () => clearTimeout(timer.current);
  }, [pathname, search]);

  return <div className={`route-progress ${state}`} aria-hidden />;
}
