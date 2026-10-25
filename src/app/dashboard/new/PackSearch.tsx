"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Package, Search } from "lucide-react";
import { format, type Messages } from "@/i18n/messages";
import type { PackHit } from "@/lib/modrinth";
import { searchModpacksAction } from "./packActions";

type Props = { t: Messages["server"]; locale: string; initial?: string };

// What the form sends for a pack found here: a Modrinth slug, or a CurseForge pack's link.
const packLink = (h: PackHit) => (h.curseforge ? `https://www.curseforge.com/minecraft/modpacks/${h.slug}` : h.slug);

// A pasted link needs no search.
const LINK = /(modrinth|curseforge)\.com/;

/**
 * "Another pack": search Modrinth and CurseForge by name, or paste a link. The field is
 * what the form sends as packLink; picking a result puts the pack's name there.
 */
export default function PackSearch({ t, locale, initial }: Props) {
  const [text, setText] = useState(initial ?? "");
  const [hits, setHits] = useState<PackHit[] | "modrinthUnavailable" | null>(null);
  const [chosen, setChosen] = useState<PackHit | null>(null);
  const [pending, start] = useTransition();
  const asked = useRef("");
  const numbers = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });

  // Search a moment after typing stops.
  useEffect(() => {
    const q = text.trim();
    if (chosen || q.length < 2 || LINK.test(q) || q === asked.current) return;
    const timer = setTimeout(() => {
      asked.current = q;
      start(async () => setHits(await searchModpacksAction(q).catch(() => "modrinthUnavailable" as const)));
    }, 400);
    return () => clearTimeout(timer);
  }, [text, chosen]);

  return (
    <div className="stack-tight pack-search">
      {chosen ? (
        <div className="pack-chosen">
          <PackIcon src={chosen.icon} />
          <span className="stack-tight">
            <strong>{format(t.packChosen, { title: chosen.title })}</strong>
            <span className="muted small">{chosen.description}</span>
          </span>
          <button type="button" className="secondary small" onClick={() => setChosen(null)}>
            {t.packChange}
          </button>
          <input type="hidden" name="packLink" value={packLink(chosen)} />
        </div>
      ) : (
        <>
          <label>
            {t.packLink}
            <span className="pack-search-field">
              <Search size={16} aria-hidden />
              <input
                name="packLink"
                required
                maxLength={300}
                autoComplete="off"
                placeholder={t.packSearchPlaceholder}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </span>
          </label>
          {pending && <p className="muted small" role="status">{t.packSearching}</p>}
          {!pending && hits === "modrinthUnavailable" && <p className="muted small">{t.errors.modrinthUnavailable}</p>}
          {!pending && Array.isArray(hits) && hits.length === 0 && <p className="muted small">{t.packNoResults}</p>}
          {Array.isArray(hits) && hits.length > 0 && !LINK.test(text) && (
            <ul className="pack-hits">
              {hits.map((h) => (
                <li key={`${h.curseforge ? "cf" : "mr"}-${h.slug}`}>
                  <button
                    type="button"
                    className="pack-hit"
                    onClick={() => {
                      setChosen(h);
                      setText(packLink(h));
                    }}
                  >
                    <PackIcon src={h.icon} />
                    <span className="stack-tight">
                      <span>
                        <strong>{h.title}</strong> <span className="chip small-chip">{h.curseforge ? t.packCurseforge : t.packModrinth}</span>
                      </span>
                      <span className="muted small">{h.description}</span>
                      <span className="muted small">
                        {h.curseforge
                          ? format(t.packMetaNoVersion, { n: numbers.format(h.downloads) })
                          : h.newestVersion
                          ? format(t.packMeta, { n: numbers.format(h.downloads), version: h.newestVersion })
                          : format(t.packMetaNoVersion, { n: numbers.format(h.downloads) })}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function PackIcon({ src }: { src?: string }) {
  return (
    <span className="plugin-icon">
      {/* eslint-disable-next-line @next/next/no-img-element -- small icons through /api/plugin-icon */}
      {src ? <img src={src} alt="" width={40} height={40} loading="lazy" referrerPolicy="no-referrer" /> : <Package size={20} aria-hidden />}
    </span>
  );
}
