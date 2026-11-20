"use client";

import { useEffect, useRef, useState } from "react";

const NUMBER = /\d+(?:[.,]\d+)?/g;

/** Rebuilds `text` with every number in it scaled by `k` (0..1), keeping the decimal
 *  places and the decimal comma, so "4,8 z 12 opinii" can count up as one string. */
function scaled(text: string, k: number) {
  return text.replace(NUMBER, (m) => {
    const sep = m.includes(",") ? "," : ".";
    const decimals = m.includes(sep) ? m.split(sep)[1].length : 0;
    const v = Number(m.replace(",", ".")) * k;
    return decimals ? v.toFixed(decimals).replace(".", sep) : String(Math.round(v));
  });
}

/** Shows `text` with its numbers counting up from 0 the first time it scrolls into view.
 *  The server renders the final text (search engines and no-JS see real prices), and an
 *  invisible copy keeps the width fixed, so nothing on the page jumps while it counts. */
export default function CountUp({ text, delay = 0, duration = 900 }: { text: string; delay?: number; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(text);

  useEffect(() => {
    const el = ref.current;
    if (!el || !/[1-9]/.test(text)) return;
    if (!("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Already on screen when the page opens: leave it, a counting price at first sight reads as a glitch.
    const r = el.getBoundingClientRect();
    if (r.top < innerHeight && r.bottom > 0) return;
    setShown(scaled(text, 0));
    let raf = 0;
    let timer = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      timer = window.setTimeout(() => {
        const t0 = performance.now();
        const step = (now: number) => {
          const p = Math.min(1, (now - t0) / duration);
          setShown(scaled(text, 1 - Math.pow(1 - p, 4))); // fast start, soft landing
          if (p < 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      }, delay);
    }, { threshold: 0.6 });
    io.observe(el);
    return () => { io.disconnect(); clearTimeout(timer); cancelAnimationFrame(raf); setShown(text); };
  }, [text, delay, duration]);

  return (
    <span className="count-up" ref={ref}>
      <span className="count-up-size" aria-hidden>{text}</span>
      <span className="count-up-live" aria-hidden={shown !== text}>{shown}</span>
      {shown !== text && <span className="visually-hidden">{text}</span>}
    </span>
  );
}
