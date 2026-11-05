"use client";

import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

/** On phones, folds long extras away behind a button; on bigger screens they always show. */
export default function ShowMore({ show, hide, children }: { show: string; hide: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`show-more${open ? " open" : ""}`}>
      <div className="show-more-body">{children}</div>
      <button type="button" className="button secondary show-more-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? hide : show} <ChevronDown size={18} aria-hidden />
      </button>
    </div>
  );
}
