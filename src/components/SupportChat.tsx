"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, Send } from "lucide-react";
import { format, type Messages } from "@/i18n/messages";
import { sendSupportMessage } from "@/app/dashboard/support/actions";
import type { ChatMessage, ChatState } from "@/lib/support";

type Props = {
  t: Messages["support"];
  initial: ChatState;
  /** Set when an admin answers this user's chat. */
  chat?: string;
  /** What the other side is called above their messages. */
  otherName: string;
  maxLength: number;
  rate: { count: number; minutes: number };
  /** The page marked unread messages read, so the badges should update. */
  hadUnread: boolean;
};

const POLL_MS = 4000;

function merge(list: ChatMessage[], more: ChatMessage[]) {
  const byId = new Map(list.map((m) => [m.id, m]));
  for (const m of more) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.at.localeCompare(b.at));
}

/** The chat window: messages that update every few seconds while the page is visible, and a box to write in. */
export default function SupportChat({ t, initial, chat, otherName, maxLength, rate, hadUnread }: Props) {
  const router = useRouter();
  const [messages, setMessages] = useState(initial.messages);
  const [seenAt, setSeenAt] = useState(initial.seenAt);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true); // keep the newest message in view unless the reader scrolled up
  const last = messages.at(-1)?.at;
  const staff = chat !== undefined;

  // Tell the top bar and the admin tabs that this chat has been read.
  useEffect(() => {
    if (!hadUnread) return;
    window.dispatchEvent(new Event("support-read"));
    router.refresh();
  }, [hadUnread, router]);

  const poll = useCallback(async () => {
    const params = new URLSearchParams({ since: last ?? new Date(0).toISOString() });
    if (chat) params.set("chat", chat);
    try {
      const res = await fetch(`/api/support?${params}`, { cache: "no-store" });
      if (!res.ok) return;
      const state = (await res.json()) as ChatState;
      setSeenAt(state.seenAt);
      if (state.messages.length > 0) setMessages((list) => merge(list, state.messages));
    } catch {
      // Offline for a moment; the next poll catches up.
    }
  }, [chat, last]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void poll();
    };
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [poll]);

  useLayoutEffect(() => {
    const el = log.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, seenAt]);

  async function send() {
    if (sending) return;
    const body = text.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    try {
      const result = await sendSupportMessage(body, chat);
      if (result.ok) {
        stick.current = true;
        setMessages((list) => merge(list, [result.message]));
        setText("");
      } else if (result.error === "signedOut") {
        router.push("/login");
      } else {
        setError(format(t.errors[result.error], { n: result.error === "tooMany" ? rate.count : maxLength, minutes: rate.minutes }));
      }
    } catch {
      setError(t.errors.failed);
    } finally {
      setSending(false);
      input.current?.focus();
    }
  }

  const mine = (m: ChatMessage) => m.fromStaff === staff;
  const lastMine = [...messages].reverse().find(mine);
  const lastIsMine = messages.length > 0 && messages.at(-1) === lastMine;

  return (
    <section className="card chat">
      <div
        className="chat-log"
        ref={log}
        role="log"
        aria-live="polite"
        aria-label={t.title}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {messages.length === 0 ? (
          <div className="chat-empty">
            <span className="chat-empty-icon"><MessageCircle size={28} aria-hidden /></span>
            <strong>{staff ? t.staffEmptyTitle : t.emptyTitle}</strong>
            <p className="muted small">{staff ? t.staffEmptyHint : t.emptyHint}</p>
            {!staff && (
              <div className="chat-suggestions">
                {t.suggestions.map((s) => (
                  <button key={s} type="button" className="chip" onClick={() => { setText(s); input.current?.focus(); }}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <ol className="chat-messages">
            {messages.map((m, i) => {
              const own = mine(m);
              const first = i === 0 || messages[i - 1].fromStaff !== m.fromStaff;
              return (
                <li key={m.id} className={`chat-msg${own ? " own" : ""}${m.fromStaff ? " staff" : ""}${first ? " first" : ""}`}>
                  {first && <span className="chat-author">{own ? t.you : otherName}</span>}
                  <p className="chat-bubble">{m.body}</p>
                  <span className="chat-time">
                    {m.time}
                    {lastIsMine && m === lastMine && seenAt && seenAt >= m.at ? ` · ${t.seen}` : ""}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          ref={input}
          name="message"
          value={text}
          rows={2}
          maxLength={maxLength}
          placeholder={staff ? t.staffPlaceholder : t.placeholder}
          aria-label={t.placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="submit" disabled={sending || !text.trim()} aria-label={t.send}>
          <Send size={18} aria-hidden /> <span className="hide-phone">{sending ? t.sending : t.send}</span>
        </button>
      </form>
      <div className="chat-foot">
        {error ? <p className="error small" role="alert">{error}</p> : <p className="muted small hide-phone">{t.keys}</p>}
        {text.length > maxLength - 200 && <span className="muted small">{text.length}/{maxLength}</span>}
      </div>
    </section>
  );
}
