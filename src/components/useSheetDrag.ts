"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * A panel that slides up from the bottom of a phone screen can be pulled down
 * to close it. It follows the finger, closes when pulled far or flicked fast,
 * and otherwise springs back. Pulling up past the top stretches only a little
 * (rubber band), so it never feels stuck.
 *
 * `handle` is where a drag may start (a header or grab bar). `when` is a media
 * query: on bigger screens nothing changes.
 */
export function useSheetDrag(
  sheet: RefObject<HTMLElement | null>,
  handle: RefObject<HTMLElement | null>,
  onClose: () => void,
  { active, when = "(max-width: 900px)", backdrop }: { active: boolean; when?: string; backdrop?: RefObject<HTMLElement | null> },
) {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const el = sheet.current;
    const grip = handle.current;
    if (!active || !el || !grip) return;
    const media = matchMedia(when);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let start = 0;
    let offset = 0;
    let dragging = false;
    let pointer = -1;
    let samples: { y: number; t: number }[] = [];
    let frame = 0;

    const set = (y: number) => {
      offset = y;
      el.style.transform = y ? `translate3d(0, ${y}px, 0)` : "";
      const fade = Math.max(0, 1 - Math.max(0, y) / Math.max(1, el.offsetHeight));
      if (backdrop?.current) backdrop.current.style.opacity = String(fade);
    };
    // A spring with no bounce (critically damped) that starts at the finger's speed.
    const spring = (to: number, velocity: number, done?: () => void) => {
      cancelAnimationFrame(frame);
      if (reduced.matches) {
        set(to);
        done?.();
        return;
      }
      const omega = 2 * Math.PI / 0.4; // settles in about 0.4 s
      const from = offset - to;
      const v0 = velocity; // px per second
      const t0 = performance.now();
      const step = (now: number) => {
        const t = (now - t0) / 1000;
        const decay = Math.exp(-omega * t);
        const x = (from + (v0 + omega * from) * t) * decay;
        const v = (v0 - omega * (v0 + omega * from) * t) * decay;
        set(to + x);
        if (Math.abs(x) < 0.5 && Math.abs(v) < 20) {
          set(to);
          done?.();
        } else {
          frame = requestAnimationFrame(step);
        }
      };
      frame = requestAnimationFrame(step);
    };

    const down = (e: PointerEvent) => {
      if (!media.matches || e.button !== 0) return;
      if ((e.target as Element).closest("button, a, input, textarea, select")) return; // a tap on the close button stays a tap
      cancelAnimationFrame(frame);
      dragging = true;
      pointer = e.pointerId;
      start = e.clientY - offset;
      samples = [{ y: e.clientY, t: e.timeStamp }];
      grip.setPointerCapture(e.pointerId);
      el.style.transition = "none";
    };
    const move = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== pointer) return;
      const raw = e.clientY - start;
      // Up past the top only stretches a little.
      const y = raw >= 0 ? raw : -(64 * -raw) / (-raw + 15);
      set(y);
      samples.push({ y: e.clientY, t: e.timeStamp });
      while (samples.length > 2 && e.timeStamp - samples[0].t > 100) samples.shift();
    };
    const up = (e: PointerEvent) => {
      if (!dragging || e.pointerId !== pointer) return;
      dragging = false;
      el.style.transition = "";
      const first = samples[0];
      const last = samples[samples.length - 1];
      const dt = Math.max(1, last.t - first.t);
      const velocity = ((last.y - first.y) / dt) * 1000;
      const height = el.offsetHeight;
      if (offset > height * 0.3 || (velocity > 600 && offset > 10)) {
        spring(height, Math.max(velocity, 0), () => {
          close.current();
          set(0);
        });
      } else {
        spring(0, velocity);
      }
    };

    grip.addEventListener("pointerdown", down);
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
    grip.addEventListener("pointercancel", up);
    return () => {
      cancelAnimationFrame(frame);
      grip.removeEventListener("pointerdown", down);
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      grip.removeEventListener("pointercancel", up);
      el.style.transform = "";
    };
  }, [active, sheet, handle, when, backdrop]);
}
