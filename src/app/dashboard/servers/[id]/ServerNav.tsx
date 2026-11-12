"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  Blocks,
  ArrowUpCircle,
  Archive,
  ChevronDown,
  ChevronsUpDown,
  CreditCard,
  FolderOpen,
  Gamepad2,
  Gift,
  Joystick,
  Globe,
  LayoutDashboard,
  Link2,
  Menu,
  MoreHorizontal,
  PackagePlus,
  Palette,
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
  mods: Blocks,
  minigames: Gamepad2,
  resourcepack: Palette,
  xbox: Joystick,
  links: Link2,
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
  t: { menu: string; servers: string; switchServer: string; more: string };
};

/** The server panel's menu: down the left on a computer, folded under a button on a phone. */
export default function ServerNav({ id, name, groups, others, t }: Props) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // The item just clicked: lit at once, before its page has arrived.
  const [going, setGoing] = useState<string | null>(null);
  const aside = useRef<HTMLElement>(null);
  const base = `/dashboard/servers/${id}`;
  // The new page is here: the real path decides what is lit again.
  useEffect(() => {
    setOpen(false);
    setGoing(null);
  }, [pathname]);

  const isActive = (item: NavItem) => {
    if (going !== null) return going === item.key;
    const paths = [item.path, ...(item.also ?? [])].map((p) => base + p);
    return item.path === "" ? pathname === base : paths.some((p) => pathname === p || pathname.startsWith(p + "/"));
  };
  const go = (item: NavItem) => () => {
    if (base + item.path === pathname) return;
    setGoing(item.key);
    setOpen(false); // the phone menu folds at once, the page loads under it
  };
  const all = groups.flatMap((g) => g.items);
  // The phone's bottom bar: the four places people go most, plus the full menu.
  const tabs = (["overview", "console", "files", "settings"] as const)
    .map((key) => all.find((item) => item.key === key))
    .filter((item): item is NavItem => !!item);
  const current = all.find(isActive);
  const CurrentIcon = current ? ICONS[current.key] : Menu;

  return (
    <aside ref={aside} className={open ? "server-nav open" : "server-nav"}>
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
                <Link key={item.key} href={base + item.path} onClick={go(item)} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
                  <Icon size={18} aria-hidden /> {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      {tabs.length > 1 && (
        <nav className="server-tabbar" aria-label={t.menu}>
          {tabs.map((item) => {
            const Icon = ICONS[item.key];
            const active = isActive(item);
            return (
              <Link key={item.key} href={base + item.path} onClick={go(item)} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
                <Icon size={20} aria-hidden />
                <span>{item.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            className={current && !tabs.includes(current) ? "active" : undefined}
            aria-expanded={open}
            onClick={() => {
              setOpen(true);
              aside.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            <MoreHorizontal size={20} aria-hidden />
            <span>{t.more}</span>
          </button>
        </nav>
      )}
    </aside>
  );
}
