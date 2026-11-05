"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/** On phones, a "create a server" button pinned to the bottom of the screen once the
 *  hero is scrolled away, and hidden again while the big green band at the end shows. */
export default function StickyCta({ href, label }: { href: string; label: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const hero = document.querySelector(".hero");
    const band = document.querySelector(".cta-band");
    if (!hero || !("IntersectionObserver" in window)) return;
    const seen = new Map<Element, boolean>([[hero, true]]);
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) seen.set(e.target, e.isIntersecting);
      setShow(![...seen.values()].some(Boolean));
    });
    io.observe(hero);
    if (band) io.observe(band);
    return () => io.disconnect();
  }, []);
  return (
    <div className={`sticky-cta${show ? " show" : ""}`} aria-hidden={!show}>
      <Link className="button large" href={href} tabIndex={show ? 0 : -1}>{label}</Link>
    </div>
  );
}
