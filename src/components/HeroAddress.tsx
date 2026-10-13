"use client";

import { useEffect, useState } from "react";

type Props = { names: string[]; domain: string };

/**
 * The address on the hero card, typing one server name after another
 * (ekipa.mchosting.pl, survival.mchosting.pl...). Stays on the first name for
 * people who turned off animations.
 */
export default function HeroAddress({ names, domain }: Props) {
  const [text, setText] = useState(names[0]);

  useEffect(() => {
    if (names.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let index = 0;
    let shown = names[0];
    let deleting = true;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      if (deleting) {
        shown = shown.slice(0, -1);
        if (shown === "") {
          deleting = false;
          index = (index + 1) % names.length;
        }
      } else {
        shown = names[index].slice(0, shown.length + 1);
      }
      setText(shown);
      const done = !deleting && shown === names[index];
      if (done) deleting = true;
      timer = setTimeout(step, done ? 2200 : deleting ? 45 : 90);
    };
    timer = setTimeout(step, 2200);
    return () => clearTimeout(timer);
  }, [names]);

  return (
    <span className="mono hero-address">
      <span className="hero-name">{text}</span>
      <span className="caret" />.{domain}
    </span>
  );
}
