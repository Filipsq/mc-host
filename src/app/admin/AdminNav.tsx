"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Messages } from "@/i18n/messages";

const LINKS = [
  ["/admin", "overview"],
  ["/admin/servers", "servers"],
  ["/admin/users", "users"],
  ["/admin/payments", "payments"],
] as const;

export default function AdminNav({ labels }: { labels: Messages["admin"]["nav"] }) {
  const path = usePathname();
  return (
    <nav className="tabs">
      {LINKS.map(([href, key]) => {
        const active = href === "/admin" ? path === href : path.startsWith(href);
        return (
          <Link key={href} href={href} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
            {labels[key]}
          </Link>
        );
      })}
    </nav>
  );
}
