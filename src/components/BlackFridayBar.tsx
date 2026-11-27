"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Tag } from "lucide-react";
import { format } from "@/i18n/messages";

/** The Black Friday bar on every page (lib/blackFriday.ts), counting down to the end of the sale. */
export default function BlackFridayBar({ endsAt, text, link, left }: { endsAt: number; text: string; link: string; left: string }) {
  // Filled in after the first render, so the server's and the browser's HTML match.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const ms = now === null ? null : Math.max(0, endsAt - now);
  const time =
    ms === null
      ? null
      : [Math.floor(ms / 3_600_000), Math.floor(ms / 60_000) % 60, Math.floor(ms / 1000) % 60].map((n) => String(n).padStart(2, "0")).join(":");
  return (
    <div className="announcement-bar black-friday-bar" role="status">
      <Tag size={16} aria-hidden />{" "}
      <span>
        <strong>{text}</strong>{" "}
        {time && <span className="black-friday-timer">{format(left, { time })}</span>} <Link href="/#cennik">{link}</Link>
      </span>
    </div>
  );
}
