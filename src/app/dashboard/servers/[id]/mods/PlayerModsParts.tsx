"use client";

import { useState, useTransition } from "react";
import { ExternalLink } from "lucide-react";
import { format, type Messages } from "@/i18n/messages";
import { makePlayerModsLink, removePlayerModsLink } from "./playerModsActions";

type T = Messages["playerMods"];
type Mod = { title: string; file: string; page: string | null; linked?: boolean };
type List = { mods: Mod[]; skipped: Mod[]; unread: string[]; mrpack: boolean; loaderVersion: string | null; mc: string | null };

/** Make, renew or turn off the players' link. */
export function PlayerModsLink({ id, has, t }: { id: string; has: boolean; t: T }) {
  const [pending, start] = useTransition();
  if (!has) {
    return (
      <div>
        <button type="button" className="secondary" disabled={pending} aria-busy={pending} onClick={() => start(() => makePlayerModsLink(id))}>
          {t.linkMake}
        </button>
      </div>
    );
  }
  return (
    <>
      <button
        type="button"
        className="secondary small"
        disabled={pending}
        onClick={() => {
          if (confirm(t.linkNewConfirm)) start(() => makePlayerModsLink(id));
        }}
      >
        {t.linkNew}
      </button>
      <button type="button" className="link small" disabled={pending} onClick={() => start(() => removePlayerModsLink(id))}>
        {t.linkOff}
      </button>
    </>
  );
}

/** What goes into the pack, checked only when the owner opens it (the first check reads every jar). */
export function PlayerModsList({ api, loader, t }: { api: string; loader: string; t: T }) {
  const [state, setState] = useState<"idle" | "loading" | "failed" | List>("idle");
  const load = async () => {
    setState("loading");
    try {
      const res = await fetch(`${api}?f=list`);
      if (!res.ok) throw new Error(String(res.status));
      setState(await res.json());
    } catch {
      setState("failed");
    }
  };
  const list = typeof state === "object" ? state : null;

  return (
    <details
      className="fold"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open && state === "idle") load();
      }}
    >
      <summary>
        {t.whatsIn}
        {list && <span className="fold-extra">{format(t.counts, { n: list.mods.length + list.unread.length, skipped: list.skipped.length })}</span>}
      </summary>
      <div className="fold-body stack-tight small">
        {state === "loading" && (
          <p className="muted" aria-live="polite">
            <span className="spinner" aria-hidden /> {t.loading}
          </p>
        )}
        {state === "failed" && (
          <p className="notice warn">
            {t.failed}{" "}
            <button type="button" className="link" onClick={load}>
              {t.retry}
            </button>
          </p>
        )}
        {list && list.mods.length + list.unread.length === 0 && <p className="muted">{t.empty}</p>}
        {list && list.mods.length + list.unread.length > 0 && (
          <>
            {!list.mrpack && <p className="notice warn">{format(t.noMrpack, { loader })}</p>}
            <strong>{t.forPlayers}</strong>
            <ModList mods={[...list.mods, ...list.unread.map((file) => ({ title: file, file, page: null }))]} t={t} />
            <strong>{t.serverOnly}</strong>
            {list.skipped.length ? <ModList mods={list.skipped} t={t} muted /> : <p className="muted">{t.none}</p>}
          </>
        )}
      </div>
    </details>
  );
}

function ModList({ mods, t, muted }: { mods: Mod[]; t: T; muted?: boolean }) {
  return (
    <ul className={muted ? "player-mods-list muted" : "player-mods-list"}>
      {mods.map((m) => (
        <li key={m.file} title={m.file}>
          {m.page ? (
            <a href={m.page} target="_blank" rel="noreferrer">
              {m.title} <ExternalLink size={11} aria-hidden />
            </a>
          ) : (
            m.title
          )}
          {m.linked === false && <span className="muted"> · {t.notOnModrinth}</span>}
        </li>
      ))}
    </ul>
  );
}
