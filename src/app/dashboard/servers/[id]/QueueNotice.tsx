"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
    // The numbers in the window: fresh every 20 s, so the line moves while you watch.
    const numbers = setInterval(() => {
      if (!document.hidden) router.refresh();
    }, 20_000);
    return () => {
      clearInterval(timer);
      clearInterval(numbers);
    };
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
        <QueueLine key={since} waiting={waiting} place={place} you={t.you} />
        <div className="queue-stats">
          <div>
            <span className="queue-stat-label">{t.place}</span>
            <strong key={place} className="queue-stat">{place}.</strong>
          </div>
          <div>
            <span className="queue-stat-label">{t.waiting}</span>
            <strong key={waiting} className="queue-stat">{waiting}</strong>
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

/**
 * A row of block heads walking to a full server: yours glows, the rest wait their turn.
 * Each head is someone's ticket (place + how many got in since the window opened), so
 * when the line moves the same heads slide forward: the front ones walk into the server,
 * newcomers join at the back. While many are ahead the view follows you: the heads step
 * and the ground scrolls under them, and the "+N" in front counts down.
 */
function QueueLine({ waiting, place, you }: { waiting: number; place: number; you: string }) {
  const [served, setServed] = useState(0);
  const [shown, setShown] = useState(place);
  const [leaving, setLeaving] = useState<{ ticket: number; slot: number }[]>([]);
  const [walking, setWalking] = useState(0);
  const mounted = useRef(false);

  // Where the line stands now, in tickets.
  const me = shown + served;
  const ahead = Math.min(shown - 1, AHEAD_SHOWN);
  const behind = Math.max(0, Math.min(waiting - shown, BEHIND_SHOWN));
  const first = me - ahead; // the visible head nearest the server
  const tickets = Array.from({ length: ahead + 1 + behind }, (_, i) => first + i);
  const slotOf = (ticket: number) => ticket - first; // 0 = next to the server

  useEffect(() => {
    if (place >= shown) {
      if (place !== shown) setShown(place);
      return;
    }
    const step = shown - place;
    const nextServed = served + step;
    const nextFirst = nextServed + place - Math.min(place - 1, AHEAD_SHOWN);
    // Heads that were in view and now are ahead of it walk out at the front.
    const gone = tickets.filter((t) => t < nextFirst).map((t) => ({ ticket: t, slot: -1 - (nextFirst - 1 - t) }));
    setLeaving(gone);
    setServed(nextServed);
    setShown(place);
    // The view only follows you while the front of the line is out of sight.
    if (first > served + 1) setWalking((w) => w + 1);
    const done = setTimeout(() => setLeaving([]), 800);
    return () => clearTimeout(done);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place]);

  useEffect(() => {
    mounted.current = true;
  }, []);

  const moreAhead = shown - 1 - ahead;
  const count = tickets.length;
  return (
    <div className={`queue-line${walking ? " walked" : ""}`} aria-hidden>
      <div className="queue-heads" style={{ "--count": count } as React.CSSProperties}>
        {[...leaving.map((l) => ({ ticket: l.ticket, slot: l.slot, gone: true })), ...tickets.map((t) => ({ ticket: t, slot: slotOf(t), gone: false }))].map(
          ({ ticket, slot, gone }) => {
            const isMe = ticket === me;
            return (
              <span
                key={ticket}
                className={`queue-slot${gone ? " gone" : ""}${mounted.current ? " joined" : ""}`}
                style={{ "--slot": slot } as React.CSSProperties}
              >
                <span
                  key={walking}
                  className={`queue-head${isMe ? " me" : ""}${walking && !gone ? " queue-walk" : ""}`}
                  style={{ "--tone": isMe ? undefined : TONES[ticket % TONES.length], "--i": Math.max(slot, 0) } as React.CSSProperties}
                >
                  {isMe && <span className="queue-you">{you}</span>}
                  <span className="queue-eyes" />
                </span>
              </span>
            );
          },
        )}
      </div>
      <span className="queue-more">{moreAhead > 0 ? `+${moreAhead}` : ""}</span>
      <span className="queue-server">
        <span className="queue-light" />
        <span className="queue-light" />
        <span className="queue-light" />
      </span>
      {walking > 0 && <span key={walking} className="queue-ground" />}
    </div>
  );
}
