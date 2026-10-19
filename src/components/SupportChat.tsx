"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, MessageCircle, Send, Trash2, X } from "lucide-react";
import { format, type Messages } from "@/i18n/messages";
import { deleteSupportMessage, sendSupportMessage } from "@/app/dashboard/support/actions";
import type { ChatMessage, ChatRate, ChatState, SendError } from "@/lib/support";

type Props = {
  t: Messages["support"];
  initial: ChatState;
  /** Set when an admin answers this user's chat. */
  chat?: string;
  /** What the other side is called above their messages. */
  otherName: string;
  maxLength: number;
  rate: ChatRate;
  /** The page marked unread messages read, so the badges should update. */
  hadUnread: boolean;
};

const POLL_MS = 4000;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
/** Photos bigger than this, or wider or taller than SHRINK_PX, are shrunk before sending. */
const SHRINK_BYTES = 1.5 * 1024 * 1024;
const SHRINK_PX = 2048;

/**
 * Phone photos are often several megabytes: send them as a JPEG at most
 * SHRINK_PX across instead. Screenshots and GIFs (which may move) stay as they are.
 */
async function shrink(file: File): Promise<File> {
  if (file.type === "image/gif") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, SHRINK_PX / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= SHRINK_BYTES) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", 0.85));
    return blob && blob.size < file.size ? new File([blob], "image.jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

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
  const [picture, setPicture] = useState<{ file: File; url: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
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
      const gone = new Set(state.deleted ?? []);
      if (state.messages.length > 0 || gone.size > 0) {
        setMessages((list) => merge(list, state.messages).filter((m) => !gone.has(m.id)));
      }
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

  useEffect(() => () => {
    if (picture) URL.revokeObjectURL(picture.url);
  }, [picture]);

  function errorText(e: SendError) {
    const n = { tooMany: rate.count, imageTooMany: rate.images, imageTooBig: rate.imageMb }[e as string] ?? maxLength;
    return format(t.errors[e], { n, minutes: rate.minutes });
  }

  function attach(file: File | undefined | null) {
    if (!file) return;
    setError(null);
    if (!IMAGE_TYPES.includes(file.type)) return setError(errorText("imageType"));
    setPicture({ file, url: URL.createObjectURL(file) });
    input.current?.focus();
  }

  async function sendPicture(file: File, body: string) {
    const ready = await shrink(file);
    if (ready.size > rate.imageMb * 1024 * 1024) return { ok: false as const, error: "imageTooBig" as const };
    const form = new FormData();
    form.set("image", ready);
    form.set("text", body);
    if (chat) form.set("chat", chat);
    const res = await fetch("/api/support/image", { method: "POST", body: form });
    if (res.status === 401) return { ok: false as const, error: "signedOut" as const };
    return (await res.json()) as Awaited<ReturnType<typeof sendSupportMessage>>;
  }

  async function send() {
    if (sending) return;
    const body = text.trim();
    if (!body && !picture) return;
    setSending(true);
    setError(null);
    try {
      const result = picture ? await sendPicture(picture.file, body) : await sendSupportMessage(body, chat);
      if (result.ok) {
        stick.current = true;
        setMessages((list) => merge(list, [result.message]));
        setText("");
        setPicture(null);
      } else if (result.error === "signedOut") {
        router.push("/login");
      } else {
        setError(errorText(result.error));
      }
    } catch {
      setError(t.errors.failed);
    } finally {
      setSending(false);
      input.current?.focus();
    }
  }

  async function remove(m: ChatMessage) {
    if (!chat || !window.confirm(t.deleteConfirm)) return;
    try {
      const result = await deleteSupportMessage(chat, m.id);
      if (result.ok) setMessages((list) => list.filter((x) => x.id !== m.id));
      else setError(t.deleteFailed);
    } catch {
      setError(t.deleteFailed);
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
                  <div className="chat-row">
                    <div className={`chat-bubble${m.image ? " with-image" : ""}`}>
                      {m.image && (
                        <a className="chat-image" href={m.image} target="_blank" rel="noopener" title={t.openImage}>
                          {/* eslint-disable-next-line @next/next/no-img-element -- a private picture, not an optimizable asset */}
                          <img
                            src={m.image}
                            alt={t.photo}
                            loading="lazy"
                            onLoad={() => {
                              const el = log.current;
                              if (el && stick.current) el.scrollTop = el.scrollHeight;
                            }}
                          />
                        </a>
                      )}
                      {m.body && <p>{m.body}</p>}
                    </div>
                    {staff && (
                      <button type="button" className="chat-delete" onClick={() => void remove(m)} aria-label={t.deleteMessage} title={t.deleteMessage}>
                        <Trash2 size={15} aria-hidden />
                      </button>
                    )}
                  </div>
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
      {picture && (
        <div className="chat-attachment">
          {/* eslint-disable-next-line @next/next/no-img-element -- a local preview */}
          <img src={picture.url} alt={t.photo} />
          <span className="muted small break">{picture.file.name}</span>
          <button type="button" className="secondary chat-attachment-remove" onClick={() => setPicture(null)} aria-label={t.removeAttachment} title={t.removeAttachment}>
            <X size={16} aria-hidden />
          </button>
        </div>
      )}
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDrop={(e) => {
          const file = e.dataTransfer.files[0];
          if (!file) return;
          e.preventDefault();
          attach(file);
        }}
      >
        <input
          ref={fileInput}
          type="file"
          accept={IMAGE_TYPES.join(",")}
          hidden
          onChange={(e) => {
            attach(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <button type="button" className="secondary chat-attach" onClick={() => fileInput.current?.click()} aria-label={t.attach} title={t.attach}>
          <ImagePlus size={18} aria-hidden />
        </button>
        <textarea
          ref={input}
          name="message"
          value={text}
          rows={2}
          maxLength={maxLength}
          placeholder={staff ? t.staffPlaceholder : t.placeholder}
          aria-label={t.placeholder}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const file = [...e.clipboardData.files].find((f) => IMAGE_TYPES.includes(f.type));
            if (!file) return;
            e.preventDefault();
            attach(file);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="submit" disabled={sending || (!text.trim() && !picture)} aria-label={t.send}>
          <Send size={18} aria-hidden /> <span className="hide-phone">{sending ? t.sending : t.send}</span>
        </button>
      </form>
      <div className="chat-foot">
        {error ? <p className="error small" role="alert">{error}</p> : <p className="muted small hide-phone">{t.keys} {t.attachHint}</p>}
        {text.length > maxLength - 200 && <span className="muted small">{text.length}/{maxLength}</span>}
      </div>
    </section>
  );
}
