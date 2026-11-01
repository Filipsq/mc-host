"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Messages } from "@/i18n/messages";

const LINKS = [
  ["/admin", "overview"],
  ["/admin/servers", "servers"],
  ["/admin/users", "users"],
  ["/admin/payments", "payments"],
  ["/admin/support", "support"],
  ["/admin/announcement", "announcement"],
  ["/admin/hytale", "hytale"],
] as const;

type Props = { labels: Messages["admin"]["nav"]; counts: Partial<Record<(typeof LINKS)[number][1], number>> };

export default function AdminNav({ labels, counts }: Props) {
  const path = usePathname();
  return (
    <nav className="tabs">
      {LINKS.map(([href, key]) => {
        const active = href === "/admin" ? path === href : path.startsWith(href);
        return (
          <Link key={href} href={href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
            {labels[key]}
            {(counts[key] ?? 0) > 0 && <span className="count-badge">{counts[key]}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
