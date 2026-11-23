"use client";

import { useEffect, useRef, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Hourglass, X, Zap } from "lucide-react";
import { leaveQueueAction, startServerAction } from "../actions";
import type { Messages } from "@/i18n/messages";

type Props = {
  id: string;
  /** When this server joined the line (ms): the window opens once per wait. */
  since: number;
  /** Free servers waiting in all, and this one's place (1 = next to start). */
  waiting: number;
  place: number;
  owner: boolean;
  price: string; // a week of Starter, ready to show
  t: Messages["server"]["queue"];
};

// Heads drawn in the line: a few in front, you, one or two behind.
const AHEAD_SHOWN = 4;
const BEHIND_SHOWN = 2;
const TONES = ["#c58f5e", "#8a6a4f", "#d9b48c", "#6f8fb3", "#b3746f", "#9a8bc4", "#7fa38a"];

/**
 * Shown while a free server waits for room: it tries to start again by itself,
 * and offers the plan that starts at once. The first time (per wait) a window
 * pops up in the middle of the screen with the line and the week of Starter.
 */
export default function QueueNotice({ id, since, waiting, place, owner, price, t }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);
  const seenKey = `queue-popup:${id}`;

  useEffect(() => {
    const timer = setInterval(async () => {
      if (document.hidden) return;
      const result = await startServerAction(id).catch(() => null);
      if (result && !result.queued) router.refresh();
    }, 45_000);
    return () => clearInterval(timer);
  }, [id, router]);

  useEffect(() => {
    let seen: string | null = null;
    try {
      seen = sessionStorage.getItem(seenKey);
    } catch {}
    if (seen !== String(since)) open();
    // Only when a new wait starts, not on every refresh of the numbers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [since]);

  function open() {
    const d = dialog.current;
    if (!d || d.open) return;
    d.showModal();
    // The window itself takes focus, not its first button (no ring on the close X).
    d.focus();
  }
  function remember() {
    try {
      sessionStorage.setItem(seenKey, String(since));
    } catch {}
  }

  const upgradeHref = `/dashboard/servers/${id}/billing?plan=STARTER&dni=7`;

  return (
    <>
      <div className="notice warn queue-notice">
        <p>
          <Hourglass size={16} aria-hidden /> <strong>{t.title}</strong> {t.text}
        </p>
        <div className="row">
          {owner && (
            <Link className="button small" href={upgradeHref}>
              {t.upgrade.replace("{price}", price)}
            </Link>
          )}
          <button className="secondary small" onClick={open}>
            {t.show}
          </button>
          <button className="secondary small" disabled={pending} onClick={() => startTransition(() => leaveQueueAction(id))}>
            {t.leave}
          </button>
        </div>
      </div>

      <dialog
        ref={dialog}
        className="queue-dialog"
        tabIndex={-1}
        aria-labelledby="queue-dialog-title"
        onClose={remember}
        onClick={(e) => {
          // A click on the dimmed background outside the box closes it.
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
      >
        <button className="queue-close" aria-label={t.close} onClick={() => dialog.current?.close()}>
          <X size={18} aria-hidden />
        </button>
        <QueueLine waiting={waiting} place={place} you={t.you} />
        <div className="queue-stats">
          <div>
            <span className="queue-stat-label">{t.place}</span>
            <strong className="queue-stat">{place}.</strong>
          </div>
          <div>
            <span className="queue-stat-label">{t.waiting}</span>
            <strong className="queue-stat">{waiting}</strong>
          </div>
        </div>
        <h3 id="queue-dialog-title">{t.popupTitle}</h3>
        <p className="queue-text">{t.popupText}</p>
        <div className="queue-actions">
          {owner && (
            <>
              <Link className="button queue-boost" href={upgradeHref} onClick={remember}>
                <Zap size={18} aria-hidden fill="currentColor" /> {t.boost.replace("{price}", price)}
              </Link>
              <span className="queue-boost-hint">{t.boostHint}</span>
            </>
          )}
          <button className={owner ? "secondary" : undefined} autoFocus={!owner} onClick={() => dialog.current?.close()}>
            {t.wait}
          </button>
        </div>
      </dialog>
    </>
  );
}

/** A row of block heads walking to a full server: yours glows, the rest wait their turn. */
function QueueLine({ waiting, place, you }: { waiting: number; place: number; you: string }) {
  const ahead = Math.min(place - 1, AHEAD_SHOWN);
  const behind = Math.min(waiting - place, BEHIND_SHOWN);
  const moreAhead = place - 1 - ahead;
  // Left to right: the back of the line, you, those in front, then the server.
  const heads = [
    ...Array.from({ length: behind }, (_, i) => ({ me: false, tone: TONES[(place + 1 + i) % TONES.length] })).reverse(),
    { me: true, tone: "" },
    ...Array.from({ length: ahead }, (_, i) => ({ me: false, tone: TONES[(place - 2 - i) % TONES.length] })).reverse(),
  ];
  const n = heads.length;
  return (
    <div className="queue-line" aria-hidden>
      <div className="queue-heads">
        {heads.map((h, i) => {
          // Staggered from the front of the line back: those nearest the server move first.
          const fromFront = n - 1 - i;
          return (
            <span
              key={i}
              className={`queue-head${h.me ? " me" : ""}`}
              style={{ "--tone": h.tone || undefined, "--i": fromFront } as React.CSSProperties}
            >
              {h.me && <span className="queue-you">{you}</span>}
              <span className="queue-eyes" />
            </span>
          );
        })}
        {moreAhead > 0 && <span className="queue-more">+{moreAhead}</span>}
      </div>
      <span className="queue-server">
        <span className="queue-light" />
        <span className="queue-light" />
        <span className="queue-light" />
      </span>
    </div>
  );
}
