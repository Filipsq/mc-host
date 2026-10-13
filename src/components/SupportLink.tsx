"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageCircle } from "lucide-react";

const CHECK_MS = 30_000;

/**
 * The "Help" button in the top bar, with the number of unread replies (or,
 * for admins, of chats waiting for an answer). It checks again on every page
 * change, every half minute while visible, and when a chat has been read.
 */
export default function SupportLink({ label, unreadLabel }: { label: string; unreadLabel: string }) {
  const path = usePathname();
  const [count, setCount] = useState(0);

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/support", { cache: "no-store" });
      if (res.ok) setCount(((await res.json()) as { count: number }).count);
    } catch {
      // Keep the last count.
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check, path]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void check();
    };
    const timer = setInterval(tick, CHECK_MS);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("support-read", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("support-read", tick);
    };
  }, [check]);

  return (
    <Link
      className="button small secondary support-link"
      href="/dashboard/support"
      aria-label={count > 0 ? `${label}: ${unreadLabel.replace("{n}", String(count))}` : label}
    >
      <MessageCircle size={16} aria-hidden /> <span className="hide-phone">{label}</span>
      {count > 0 && <span className="count-badge" aria-hidden>{count > 9 ? "9+" : count}</span>}
    </Link>
  );
}
