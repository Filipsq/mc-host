"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpCircle,
  Archive,
  ChevronDown,
  ChevronsUpDown,
  CreditCard,
  FolderOpen,
  Gift,
  Globe,
  LayoutDashboard,
  Menu,
  PackagePlus,
  Puzzle,
  SlidersHorizontal,
  Terminal,
  Users,
} from "lucide-react";

const ICONS = {
  overview: LayoutDashboard,
  console: Terminal,
  files: FolderOpen,
  settings: SlidersHorizontal,
  backups: Archive,
  worlds: Globe,
  plugins: Puzzle,
  billing: CreditCard,
  upgrade: ArrowUpCircle,
  addons: PackagePlus,
  access: Users,
  creator: Gift,
};

export type NavItem = { key: keyof typeof ICONS; label: string; path: string; also?: string[] };
export type NavGroup = { title?: string; items: NavItem[] };

type Props = {
  id: string;
  name: string;
  groups: NavGroup[];
  // The user's other servers, to jump between them like between tabs.
  others: { id: string; name: string }[];
  t: { menu: string; servers: string; switchServer: string };
};

/** The server panel's menu: down the left on a computer, folded under a button on a phone. */
export default function ServerNav({ id, name, groups, others, t }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const base = `/dashboard/servers/${id}`;
  // Each page closes the phone menu, so the page it opened shows.
  useEffect(() => setOpen(false), [pathname]);

  const isActive = (item: NavItem) => {
    const paths = [item.path, ...(item.also ?? [])].map((p) => base + p);
    return item.path === "" ? pathname === base : paths.some((p) => pathname === p || pathname.startsWith(p + "/"));
  };
  const current = groups.flatMap((g) => g.items).find(isActive);
  const CurrentIcon = current ? ICONS[current.key] : Menu;

  return (
    <aside className={open ? "server-nav open" : "server-nav"}>
      <button className="server-nav-toggle secondary" aria-expanded={open} onClick={() => setOpen(!open)}>
        <CurrentIcon size={18} aria-hidden />
        <span>{current?.label ?? t.menu}</span>
        <ChevronDown size={18} aria-hidden className="server-nav-chevron" />
      </button>
      <nav className="server-nav-body" aria-label={t.menu}>
        {others.length > 0 ? (
          <details className="server-switch">
            <summary title={t.switchServer}>
              <span className="server-switch-name">{name}</span>
              <ChevronsUpDown size={16} aria-hidden />
            </summary>
            <div className="server-switch-list">
              {others.map((s) => (
                <Link key={s.id} href={`/dashboard/servers/${s.id}`}>
                  {s.name}
                </Link>
              ))}
              <Link className="muted" href="/dashboard">
                <ArrowLeft size={14} aria-hidden /> {t.servers}
              </Link>
            </div>
          </details>
        ) : (
          <Link className="server-switch-back" href="/dashboard">
            <ArrowLeft size={16} aria-hidden /> {t.servers}
          </Link>
        )}
        {groups.map((group, i) => (
          <div key={i} className="server-nav-group">
            {group.title && <p className="server-nav-title">{group.title}</p>}
            {group.items.map((item) => {
              const Icon = ICONS[item.key];
              const active = isActive(item);
              return (
                <Link key={item.key} href={base + item.path} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
                  <Icon size={18} aria-hidden /> {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
