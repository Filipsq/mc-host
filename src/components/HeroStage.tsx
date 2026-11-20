"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** The hero's picture side as a little diorama: the island, a few floating blocks
 *  and the panel window sit at different depths and drift a few pixels with the
 *  mouse. Only with a real mouse and when animations are allowed; on phones and
 *  with reduced motion everything simply stays put. */
export default function HeroStage({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stage = ref.current;
    if (!stage) return;
    if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let tx = 0, ty = 0, x = 0, y = 0, raf = 0;
    const loop = () => {
      x += (tx - x) * 0.12;
      y += (ty - y) * 0.12;
      stage.style.setProperty("--mx", x.toFixed(4));
      stage.style.setProperty("--my", y.toFixed(4));
      raf = Math.abs(tx - x) > 0.0005 || Math.abs(ty - y) > 0.0005 ? requestAnimationFrame(loop) : 0;
    };
    const onMove = (e: PointerEvent) => {
      // Only while the hero is on screen; further down the page nothing moves.
      if (window.scrollY > window.innerHeight) return;
      tx = e.clientX / window.innerWidth - 0.5;
      ty = e.clientY / window.innerHeight - 0.5;
      if (!raf) raf = requestAnimationFrame(loop);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="hero-art" ref={ref}>
      {children}
    </div>
  );
}

/** A blocky grass edge the hero stands on: grass with a stepped top, then dirt
 *  that darkens into the page. Square 16px blocks; wide screens crop the sides. */
export function HeroGround() {
  // Grass height of each column in blocks (1 or 2), a fixed uneven pattern.
  const n = 120;
  const steps = Array.from({ length: n }, (_, i) => ((i * 7 + (i >> 2) * 3) % 5 < 3 ? 1 : 2));
  return (
    <svg className="hero-ground" viewBox={`0 0 ${n} 4`} preserveAspectRatio="xMidYMax slice" shapeRendering="crispEdges" aria-hidden>
      <defs>
        <linearGradient id="hg-dirt" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b2819" />
          <stop offset="1" stopColor="#0b0f14" />
        </linearGradient>
      </defs>
      <rect x="0" y="2" width={n} height="2" fill="url(#hg-dirt)" />
      {steps.map((h, i) => (
        <rect key={i} x={i} y={2 - h} width="1.01" height={h} fill={i % 5 === 2 ? "#5bc236" : i % 3 === 1 ? "#3f8a26" : "#4a9e2b"} />
      ))}
      <rect x="0" y="2" width={n} height="0.25" fill="#2a5a19" />
    </svg>
  );
}
