"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Maximize2, MessageCircle, X } from "lucide-react";
import type { Messages } from "@/i18n/messages";
import type { ChatState } from "@/lib/support";
import SupportChat from "./SupportChat";

type Props = {
  t: Messages["support"];
  signedIn: boolean;
  admin: boolean;
  /** Whether an admin was on the site when the page was rendered; kept up to date by polling. */
  adminOnline: boolean;
  maxLength: number;
  rate: { count: number; minutes: number };
};

const CHECK_MS = 30_000;
const TIP_DELAY_MS = 1500;
/** Shown once per browser session, so it greets visitors without nagging on every page. */
const TIP_KEY = "help-tip-shown";
/** Set when a signed-out visitor goes to log in from the bubble, so the chat opens once they are back. */
const OPEN_KEY = "help-open-after-login";

function storage(fn: (s: Storage) => string | null | void) {
  try {
    return fn(window.sessionStorage);
  } catch {
    return null; // Private mode or blocked storage: the bubble still works, the tip just shows again.
  }
}

/**
 * The round help button in the bottom right corner of every page. It opens the
 * chat with the admins in a small window (for visitors, a prompt to log in),
 * shows the number of unread replies, and greets new visitors with a short note
 * saying it is a chat with an admin. Admins are taken to their chat list.
 */
export default function HelpBubble({ t, signedIn, admin, adminOnline, maxLength, rate }: Props) {
  const path = usePathname();
  const [count, setCount] = useState(0);
  const [online, setOnline] = useState(adminOnline);
  const [open, setOpen] = useState(false);
  const [tip, setTip] = useState(false);
  const [chat, setChat] = useState<{ state: ChatState; hadUnread: boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // The full chat page and the admin panel have their own chat.
  const hidden = path.startsWith("/dashboard/support") || path.startsWith("/admin");

  const check = useCallback(async () => {
    if (!admin) {
      fetch("/api/support/online", { cache: "no-store" })
        .then(async (res) => res.ok && setOnline(((await res.json()) as { online: boolean }).online))
        .catch(() => {});
    }
    // Admins poll this too, which is what tells visitors an admin is online.
    if (!signedIn) return;
    try {
      const res = await fetch("/api/support", { cache: "no-store" });
      if (res.ok) setCount(((await res.json()) as { count: number }).count);
    } catch {
      // Keep the last count.
    }
  }, [signedIn, admin]);

  useEffect(() => {
    void check();
  }, [check, path]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void check();
    };
    const timer = setInterval(tick, CHECK_MS);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("support-read", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("support-read", tick);
    };
  }, [check]);

  // Greet a visitor once per browser session.
  useEffect(() => {
    if (admin || hidden || storage((s) => s.getItem(TIP_KEY))) return;
    const timer = setTimeout(() => {
      setTip(true);
      storage((s) => s.setItem(TIP_KEY, "1"));
    }, TIP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [admin, hidden]);

  // Back from logging in through the bubble: open the chat right away.
  useEffect(() => {
    if (signedIn && !admin && storage((s) => s.getItem(OPEN_KEY))) {
      storage((s) => s.removeItem(OPEN_KEY));
      setOpen(true);
    }
  }, [signedIn, admin]);

  // Load the conversation the first time the window opens; the chat keeps itself up to date from then on.
  useEffect(() => {
    if (!open || !signedIn || chat) return;
    let gone = false;
    setFailed(false);
    const hadUnread = count > 0;
    fetch(`/api/support?since=${new Date(0).toISOString()}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const state = (await res.json()) as ChatState;
        if (!gone) setChat({ state, hadUnread });
      })
      .catch(() => !gone && setFailed(true));
    return () => {
      gone = true;
    };
    // `count` only says whether this load marked replies read; it must not reload the chat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, signedIn, chat, attempt]);

  // Opening the window shows the replies, so the badge clears.
  useEffect(() => {
    if (open && chat) setCount(0);
  }, [open, chat]);

  useEffect(() => {
    if (!open) return;
    setTip(false);
    panel.current?.querySelector<HTMLElement>("textarea, a, button:not(.help-close)")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, chat]);

  if (hidden) return null;

  const badge = count > 0 && <span className="count-badge" aria-hidden>{count > 9 ? "9+" : count}</span>;
  const label = count > 0 ? `${t.bubble.open}: ${t.unread.replace("{n}", String(count))}` : t.bubble.open;

  if (admin) {
    return (
      <div className="help">
        <Link className="help-fab" href="/admin/support" aria-label={label} title={t.admin.title}>
          <MessageCircle size={26} aria-hidden />
          {badge}
        </Link>
      </div>
    );
  }

  return (
    <div className={open ? "help open" : "help"}>
      {open && (
        <div className="help-panel" ref={panel} role="dialog" aria-modal="false" aria-labelledby="help-title">
          <header className="help-head">
            <span className="help-avatar" aria-hidden><MessageCircle size={20} /></span>
            <div className="help-head-text">
              <strong id="help-title">{t.title}</strong>
              <span className="muted small">
                <span className={online ? "dot online" : "dot"} aria-hidden /> {online ? t.bubble.status : t.bubble.offlineStatus}
              </span>
            </div>
            {signedIn && (
              <Link className="help-icon" href="/dashboard/support" aria-label={t.bubble.fullScreen} title={t.bubble.fullScreen} onClick={() => setOpen(false)}>
                <Maximize2 size={17} aria-hidden />
              </Link>
            )}
            <button type="button" className="help-icon help-close" aria-label={t.bubble.close} title={t.bubble.close} onClick={() => setOpen(false)}>
              <X size={20} aria-hidden />
            </button>
          </header>
          {!signedIn ? (
            <div className="help-guest">
              <span className="chat-empty-icon"><MessageCircle size={28} aria-hidden /></span>
              <p>{t.bubble.guest}</p>
              <div className="help-guest-actions">
                <Link className="button" href="/login" onClick={() => storage((s) => s.setItem(OPEN_KEY, "1"))}>{t.bubble.logIn}</Link>
                <Link className="button secondary" href="/signup" onClick={() => storage((s) => s.setItem(OPEN_KEY, "1"))}>{t.bubble.signUp}</Link>
              </div>
            </div>
          ) : chat ? (
            <SupportChat
              t={t}
              initial={chat.state}
              otherName={t.staff}
              maxLength={maxLength}
              rate={rate}
              hadUnread={chat.hadUnread}
            />
          ) : (
            <div className="help-guest">
              {failed ? (
                <>
                  <p className="error small" role="alert">{t.bubble.failed}</p>
                  <button type="button" className="secondary small" onClick={() => setAttempt((n) => n + 1)}>{t.bubble.retry}</button>
                </>
              ) : (
                <p className="muted small">{t.bubble.loading}</p>
              )}
            </div>
          )}
        </div>
      )}
      {tip && !open && (
        <div className="help-tip" role="status">
          <button type="button" className="help-tip-body" onClick={() => setOpen(true)}>
            <strong>{t.bubble.tipTitle}</strong>
            <span>{t.bubble.tipText}</span>
          </button>
          <button type="button" className="help-tip-close" aria-label={t.bubble.dismiss} title={t.bubble.dismiss} onClick={() => setTip(false)}>
            <X size={14} aria-hidden />
          </button>
        </div>
      )}
      {!online && !open && !tip && (
        <button type="button" className="help-sleep" onClick={() => setOpen(true)} aria-label={`${t.bubble.offline}. ${t.bubble.open}`}>
          <span className="help-sleep-say">{t.bubble.offline}</span>
          <span className="help-sleep-steve">
            <SleepingSteve title={t.bubble.sleeping} />
            <span className="help-sleep-z" aria-hidden><i>z</i><i>z</i><i>Z</i></span>
          </span>
        </button>
      )}
      <button
        ref={button}
        type="button"
        className="help-fab"
        aria-label={open ? t.bubble.close : label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <X size={26} aria-hidden /> : <MessageCircle size={26} aria-hidden />}
        {!open && badge}
      </button>
    </div>
  );
}

/** Pixels of the sleeping head, a row per line: hair, skin, shade, closed eyes, nose, mouth. */
const STEVE = [
  "hhhhhhhh",
  "hhhhhhhh",
  "hssssssh",
  "ssssssss",
  "seessees",
  "sssnnsss",
  "ssmmmmss",
  "dssssssd",
];
const STEVE_COLORS: Record<string, string> = {
  h: "#3d2a19", s: "#c8996b", d: "#a97c52", e: "#4b3020", n: "#9c6b45", m: "#6e4430",
};

/** A blocky sleeping Steve, drawn here from squares in the site's pixel style. */
function SleepingSteve({ title }: { title: string }) {
  return (
    <svg viewBox="0 0 8 8" width="44" height="44" shapeRendering="crispEdges" role="img" aria-label={title}>
      {STEVE.flatMap((row, y) =>
        [...row].map((c, x) => <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={STEVE_COLORS[c]} />),
      )}
    </svg>
  );
}
