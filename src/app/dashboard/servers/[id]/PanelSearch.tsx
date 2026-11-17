"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AtSign, CornerDownLeft, Image as ImageIcon, KeyRound, Pencil, Search, Shapes, SlidersHorizontal, Trash2, X } from "lucide-react";
import { ICONS } from "./ServerNav";
import { format, type Messages } from "@/i18n/messages";

const MORE_ICONS = {
  ...ICONS,
  option: SlidersHorizontal,
  type: Shapes,
  address: AtSign,
  name: Pencil,
  icon: ImageIcon,
  password: KeyRound,
  delete: Trash2,
};

export type SearchItem = {
  label: string;
  /** "page" for a menu item, "option" for one field of a page. */
  kind: "page" | "option";
  /** Where it lives, e.g. "Ustawienia", shown under the label. */
  where?: string;
  path: string; // under the server, e.g. "/settings"
  /** The form field (its name="") or element id to scroll to and light up once the page is there. */
  field?: string;
  anchor?: string;
  icon: keyof typeof MORE_ICONS;
  keywords: string;
};

// "Świat", "swiat" and "ŚWIAT" are one word to the search: no case, no Polish marks.
const plain = (s: string) =>
  s
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const words = (s: string) => plain(s).split(/[^a-z0-9.]+/).filter(Boolean);

// Edits between two short words, given up as soon as it's over `max`.
function distance(a: string, b: string, max: number) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  // Two letters swapped ("plugni") count as one edit.
  let before: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const swap = i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] ? before[j - 2] + 1 : Infinity;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), swap);
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    before = prev;
    prev = cur;
  }
  return prev[b.length];
}

// How well one typed word fits a list of words: 0 = not at all.
function fit(token: string, list: string[]) {
  let best = 0;
  // A typo or two is forgiven in longer words: "plgulny", "whitlist".
  const slack = token.length >= 7 ? 2 : token.length >= 4 ? 1 : 0;
  for (const w of list) {
    if (w === token) return 10;
    if (w.startsWith(token)) best = Math.max(best, 8);
    else if (w.includes(token) && token.length >= 3) best = Math.max(best, 5);
    else if (slack) {
      const d = Math.min(distance(token, w, slack), w.length > token.length ? distance(token, w.slice(0, token.length), slack) : slack + 1);
      if (d <= slack) best = Math.max(best, 4 - d);
    }
  }
  return best;
}

export function rank(items: SearchItem[], query: string) {
  const tokens = words(query);
  if (tokens.length === 0) return items.filter((i) => i.kind === "page");
  const scored: { item: SearchItem; score: number }[] = [];
  items.forEach((item, order) => {
    const label = words(item.label);
    const rest = words(`${item.keywords} ${item.where ?? ""}`);
    let score = 0;
    for (const token of tokens) {
      // The name on screen counts more than a hidden synonym.
      const s = Math.max(fit(token, label) * 2, fit(token, rest));
      if (s === 0) return;
      score += s;
    }
    if (item.kind === "page") score += 1;
    scored.push({ item, score: score * 1000 - order });
  });
  return scored.sort((a, b) => b.score - a.score).map((s) => s.item).slice(0, 30);
}

type Props = { id: string; items: SearchItem[]; t: Messages["panelSearch"] };

/** Ctrl+K (or the magnifier): a box in the middle of the screen that finds pages and single options of this server's panel. */
export default function PanelSearch({ id, items, t }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(0);
  const [mac, setMac] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const results = useMemo(() => rank(items, query), [items, query]);
  const base = `/dashboard/servers/${id}`;

  useEffect(() => setMac(/Mac|iPhone|iPad/.test(navigator.platform)), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setPicked(0);
    input.current?.focus();
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = old;
    };
  }, [open]);
  useEffect(() => setPicked(0), [query]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${picked}"]`)?.scrollIntoView({ block: "nearest" });
  }, [picked]);

  const go = (item: SearchItem) => {
    setOpen(false);
    const target = base + item.path;
    if (pathname !== target) router.push(target);
    if (!item.field && !item.anchor) return;
    // The page may still be on its way: wait for the field, then bring it to the middle and light it up.
    const until = Date.now() + 8000;
    const look = () => {
      const el = item.anchor ? document.getElementById(item.anchor) : document.getElementsByName(item.field!)[0];
      const box = el && !item.anchor ? (el.closest("label:not([hidden]), fieldset") as HTMLElement | null) : el;
      if (box && window.location.pathname === target) {
        box.scrollIntoView({ behavior: "smooth", block: "center" });
        box.classList.remove("search-flash");
        void box.offsetWidth; // restart the glow when the same option is picked twice
        box.classList.add("search-flash");
        setTimeout(() => box.classList.remove("search-flash"), 2400);
        if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) el.focus({ preventScroll: true });
        return;
      }
      if (Date.now() < until) setTimeout(look, 120);
    };
    setTimeout(look, 60);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") setOpen(false);
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setPicked((p) => Math.min(p + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setPicked((p) => Math.max(p - 1, 0));
    } else if (e.key === "Enter" && results[picked]) {
      e.preventDefault();
      go(results[picked]);
    }
  };

  return (
    <>
      <button type="button" className="secondary panel-search-button" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Search size={16} aria-hidden />
        <span>{t.button}</span>
        <kbd>{mac ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      {open && (
        <div className="panel-search-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="panel-search" role="dialog" aria-modal="true" aria-label={t.button} onKeyDown={onKeyDown}>
            <div className="panel-search-input">
              <Search size={20} aria-hidden />
              <input
                ref={input}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t.placeholder}
                aria-label={t.placeholder}
                role="combobox"
                aria-expanded
                aria-controls="panel-search-results"
                aria-activedescendant={results[picked] ? `panel-search-${picked}` : undefined}
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="go"
              />
              <button type="button" className="panel-search-close" onClick={() => setOpen(false)} aria-label={t.close}>
                <X size={18} aria-hidden />
              </button>
            </div>
            {results.length === 0 ? (
              <p className="panel-search-empty muted">{format(t.empty, { q: query.trim() })}</p>
            ) : (
              <ul ref={list} id="panel-search-results" role="listbox" className="panel-search-results">
                {results.map((item, i) => {
                  const Icon = MORE_ICONS[item.icon];
                  return (
                    <li key={`${item.path}#${item.field ?? item.anchor ?? ""}`} role="presentation">
                      <button
                        type="button"
                        id={`panel-search-${i}`}
                        data-i={i}
                        role="option"
                        aria-selected={i === picked}
                        className={i === picked ? "picked" : undefined}
                        onMouseMove={() => i !== picked && setPicked(i)}
                        onClick={() => go(item)}
                      >
                        <Icon size={18} aria-hidden />
                        <span className="panel-search-label">
                          <span>{item.label}</span>
                          {item.where && <span className="muted small">{item.where}</span>}
                        </span>
                        {i === picked && <CornerDownLeft size={16} aria-hidden className="panel-search-enter" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="panel-search-hint muted small">{t.hint}</p>
          </div>
        </div>
      )}
    </>
  );
}
