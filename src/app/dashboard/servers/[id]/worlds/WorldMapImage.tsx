"use client";

import { useState } from "react";

/** The world from above; a note instead when there's nothing to draw yet. */
export default function WorldMapImage({ src, alt, none }: { src: string; alt: string; none: string }) {
  const [state, setState] = useState<"loading" | "ok" | "none">("loading");
  if (state === "none") return <p className="notice">{none}</p>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className={state === "loading" ? "world-map-img loading" : "world-map-img"}
      src={src}
      alt={alt}
      width={512}
      height={512}
      onLoad={() => setState("ok")}
      onError={() => setState("none")}
    />
  );
}
