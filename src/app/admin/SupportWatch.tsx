"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const CHECK_MS = 5000;

/**
 * Keeps the admin panel up to date with the help chat: checks every few seconds
 * while the page is visible and re-renders it when a message came in or the
 * number of chats waiting changed, so the Czat tab and the chat list show it
 * without reloading.
 */
export default function SupportWatch() {
  const router = useRouter();
  const seen = useRef<string | null>(null);

  useEffect(() => {
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const res = await fetch("/api/support?latest=1", { cache: "no-store" });
        if (!res.ok) return;
        const { count, latest } = (await res.json()) as { count: number; latest: string | null };
        const stamp = `${count}|${latest}`;
        if (seen.current !== null && seen.current !== stamp) router.refresh();
        seen.current = stamp;
      } catch {
        // Offline for a moment; the next check catches up.
      } finally {
        busy = false;
      }
    };
    void check();
    const timer = setInterval(check, CHECK_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [router]);

  return null;
}
