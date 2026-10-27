"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import CopyButton from "./CopyButton";

// The Halloween pumpkin hunt (lib/halloween.ts): pumpkins hidden around the home
// page, each caught with a click. What was found is kept in this browser only, so
// the new-server form can fill in the code once all of them are.

const KEY = "halloween-pumpkins";
const EVENT = "halloween-hunt";

/** The pumpkins found in this browser so far. */
export function huntFound(): string[] {
  try {
    const found = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(found) ? found.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// Kept here too, for a browser that won't store anything.
let inMemory: string[] = [];

function found() {
  const stored = huntFound();
  return stored.length >= inMemory.length ? stored : inMemory;
}

function useFound() {
  const [list, setList] = useState<string[]>([]);
  useEffect(() => {
    const update = () => setList(found());
    update();
    window.addEventListener(EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return list;
}

// A blocky pumpkin, row by row: O orange, o its ridges, y the glow inside, G the stem.
const PUMPKIN = [
  ".....GG.....",
  "......G.....",
  "..OOoOOoOO..",
  ".OOoOOOOoOO.",
  "OOoyyOOyyoOO",
  "OOoyyOOyyoOO",
  "OOoOOyyOOoOO",
  "OOyOyOyOyOOO",
  "OOOyyyyyyOOO",
  ".OOoOOOOoOO.",
  "..OOoOOoOO..",
];
const COLORS: Record<string, string> = { O: "#f47b1c", o: "#c4560b", y: "#ffd23f", G: "#4c9a2a" };

export function PixelPumpkin({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={(size * PUMPKIN.length) / 12} viewBox={`0 0 12 ${PUMPKIN.length}`} shapeRendering="crispEdges" aria-hidden>
      {PUMPKIN.flatMap((row, y) =>
        [...row].map((c, x) => (c in COLORS ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={COLORS[c]} /> : null)),
      )}
    </svg>
  );
}

/** One hidden pumpkin; gone once caught. */
export function HuntPumpkin({ id, label, className }: { id: string; label: string; className?: string }) {
  const list = useFound();
  const [popping, setPopping] = useState(false);
  if (list.includes(id) && !popping) return null;

  function catchIt() {
    if (popping) return;
    const next = [...new Set([...found(), id])];
    inMemory = next;
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {}
    setPopping(true);
    window.dispatchEvent(new Event(EVENT));
    setTimeout(() => setPopping(false), 500);
  }

  return (
    <button type="button" className={`hunt-pumpkin${popping ? " caught" : ""}${className ? ` ${className}` : ""}`} onClick={catchIt} aria-label={label} title={label}>
      <PixelPumpkin size={34} />
    </button>
  );
}

type ProgressProps = {
  total: number;
  code: string;
  t: { progress: string; done: string; buy: string; copied: string; copy: string };
  href: string;
};

/** How many pumpkins were found, and the code once all of them are. */
export function HuntProgress({ total, code, t, href }: ProgressProps) {
  const n = Math.min(useFound().length, total);
  const done = n >= total;
  return (
    <div className={`hunt-progress${done ? " done" : ""}`} aria-live="polite">
      <div className="hunt-slots" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={i < n ? "hunt-slot got" : "hunt-slot"}>
            <PixelPumpkin size={28} />
          </span>
        ))}
      </div>
      <p className="hunt-count">{t.progress.replace("{n}", String(n)).replace("{total}", String(total))}</p>
      {done && (
        <div className="hunt-code">
          <p>
            <Check size={16} aria-hidden /> {t.done}
          </p>
          <div className="hunt-code-row">
            <code>{code.toUpperCase()}</code>
            <CopyButton text={code.toUpperCase()} label={t.copy} copiedLabel={t.copied} />
            <Link className="button" href={href}>{t.buy}</Link>
          </div>
        </div>
      )}
    </div>
  );
}
