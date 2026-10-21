"use client";

import { useEffect } from "react";

/** Pauses the home page's little art animations while they're scrolled out of view,
 *  so the browser only runs the ones you can see. */
export default function PauseOffscreen() {
  useEffect(() => {
    const boxes = document.querySelectorAll<HTMLElement>(".art, .game-art");
    if (!("IntersectionObserver" in window) || boxes.length === 0) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) e.target.classList.toggle("paused", !e.isIntersecting);
    });
    boxes.forEach((b) => io.observe(b));
    return () => io.disconnect();
  }, []);
  return null;
}
