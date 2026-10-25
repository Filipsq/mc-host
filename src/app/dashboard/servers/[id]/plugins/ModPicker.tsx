"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Plus, Puzzle } from "lucide-react";
import { format, type Messages } from "@/i18n/messages";
import type { PluginHit } from "@/lib/modrinth";

type Props = {
  id: string;
  hits: PluginHit[];
  needsPlan: boolean; // the server's plan has less memory than mods want
  planName: string; // the plan mods want
  t: Messages["modsOnPlain"];
  downloads: string; // "{n} downloads"
  locale: string;
};

type Picked = { id: string; title: string };

// Kept for the browser tab, so the picks survive another search.
const storageKey = (id: string) => `mchost-picked-mods-${id}`;

function load(id: string): Picked[] {
  try {
    const list = JSON.parse(sessionStorage.getItem(storageKey(id)) ?? "[]");
    return Array.isArray(list) ? list.filter((p) => typeof p?.id === "string" && typeof p?.title === "string").slice(0, 50) : [];
  } catch {
    return [];
  }
}

/**
 * Mods shown on a plain Paper server, which can't run them: the owner picks
 * them as on a mod server, and only then learns that the server has to become
 * a Fabric one (on a plan with enough memory), which the type page does with the picks.
 */
export default function ModPicker({ id, hits, needsPlan, planName, t, downloads, locale }: Props) {
  const numbers = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
  const [picked, setPicked] = useState<Picked[]>([]);
  useEffect(() => setPicked(load(id)), [id]);
  const save = (list: Picked[]) => {
    setPicked(list);
    try {
      sessionStorage.setItem(storageKey(id), JSON.stringify(list));
    } catch {}
  };
  const has = (pid: string) => picked.some((p) => p.id === pid);
  const toggle = (h: PluginHit) => save(has(h.id) ? picked.filter((p) => p.id !== h.id) : [...picked, { id: h.id, title: h.title }].slice(0, 50));
  const typeHref = `/dashboard/servers/${id}/type?${new URLSearchParams({ type: "mods", loader: "fabric", mods: picked.map((p) => p.id).join(",") })}`;

  return (
    <>
      {hits.length === 0 ? (
        <p className="muted">{t.noResults}</p>
      ) : (
        <ul className="card plugin-list">
          {hits.map((h) => (
            <li key={h.id}>
              <span className="plugin-icon">
                {/* eslint-disable-next-line @next/next/no-img-element -- small icons through /api/plugin-icon */}
                {h.icon ? <img src={h.icon} alt="" width={40} height={40} loading="lazy" referrerPolicy="no-referrer" /> : <Puzzle size={20} aria-hidden />}
              </span>
              <span className="plugin-main">
                <strong>{h.title}</strong>
                <span className="muted small">{h.description}</span>
                <span className="muted small">{format(downloads, { n: numbers.format(h.downloads) })}</span>
              </span>
              <span className="plugin-action">
                <button type="button" className="secondary small" onClick={() => toggle(h)}>
                  {has(h.id) ? <Check size={15} aria-hidden /> : <Plus size={15} aria-hidden />} {has(h.id) ? t.picked : t.pick}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {picked.length > 0 && (
        <div className="notice warn stack-tight mod-cart">
          <strong>{format(t.cartTitle, { n: picked.length })}</strong>
          <span className="small">{picked.map((p) => p.title).join(", ")}</span>
          <span>{t.cartWhy}</span>
          {needsPlan && <span>{format(t.cartPlan, { plan: planName })}</span>}
          <span className="row">
            <Link className="button small" href={typeHref}>
              {t.cartSwitch} <ArrowRight size={15} aria-hidden />
            </Link>
            {needsPlan && (
              <Link className="button secondary small" href={`/dashboard/servers/${id}/billing`}>
                {format(t.cartUpgrade, { plan: planName })}
              </Link>
            )}
            <button type="button" className="secondary small" onClick={() => save([])}>
              {t.cartClear}
            </button>
          </span>
        </div>
      )}
    </>
  );
}
