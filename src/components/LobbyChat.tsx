"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, Flag, Info, MessagesSquare, MoreHorizontal, Send, Server, Trash2, X } from "lucide-react";
import { format, type Messages } from "@/i18n/messages";
import { moderateLobby, reportLobbyMessage, sendLobbyMessage, setChatNameAction, type ModAction } from "@/app/dashboard/chat/actions";
import type { LobbyError, LobbyMessage, LobbyState, ReportReason } from "@/lib/lobby";
import CopyButton from "./CopyButton";

type Props = {
  t: Messages["lobby"];
  /** Loaded on the server (the full page); the help bubble loads it itself. */
  initial?: LobbyState;
  maxLength: number;
};

const POLL_MS = 5000;
const REASONS: ReportReason[] = ["rude", "spam", "personal", "other"];
const MUTE_HOURS = [1, 24, 168] as const;

function merge(list: LobbyMessage[], more: LobbyMessage[]) {
  const byId = new Map(list.map((m) => [m.id, m]));
  for (const m of more) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-200);
}

/**
 * The players' chat: one room for everyone signed in. It polls for new
 * messages while visible, asks for a nickname before the first message, and
 * gives every message a report button (admins: delete and mute instead).
 */
export default function LobbyChat({ t, initial, maxLength }: Props) {
  const router = useRouter();
  const [state, setState] = useState<LobbyState | null>(initial ?? null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [text, setText] = useState("");
  const [server, setServer] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rules, setRules] = useState(false);
  const [menu, setMenu] = useState<{ id: string; kind: "report" | "mod" } | null>(null);
  const [note, setNote] = useState<{ id: string; text: string } | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const messages = state?.messages ?? [];
  const last = messages.at(-1)?.at;
  const admin = state?.me.admin ?? false;

  // First load (the help bubble), and again on "Try again".
  useEffect(() => {
    if (state) return;
    let gone = false;
    setFailed(false);
    fetch("/api/lobby", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const s = (await res.json()) as LobbyState;
        if (!gone) setState(s);
      })
      .catch(() => !gone && setFailed(true));
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const poll = useCallback(async () => {
    if (!state) return;
    try {
      const res = await fetch(`/api/lobby?since=${encodeURIComponent(last ?? new Date(0).toISOString())}`, { cache: "no-store" });
      if (!res.ok) return;
      const next = (await res.json()) as LobbyState;
      const gone = new Set(next.deleted ?? []);
      setState((s) =>
        s && {
          ...s,
          on: next.on,
          me: next.me,
          online: next.online,
          messages: merge(s.messages, next.messages).filter((m) => !gone.has(m.id)),
        },
      );
    } catch {
      // Offline for a moment; the next poll catches up.
    }
  }, [state, last]);

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
  }, [messages.length, state?.me.name]);

  function errorText(e: LobbyError | "reportTooMany") {
    if (e === "signedOut") {
      router.push("/login");
      return t.errors.signedOut;
    }
    return format(t.errors[e] ?? t.errors.failed, { n: maxLength });
  }

  async function send() {
    if (sending || !state) return;
    const body = text.trim();
    if (!body && !server) return;
    setSending(true);
    setError(null);
    try {
      const result = await sendLobbyMessage(body, server ?? undefined);
      if (result.ok) {
        stick.current = true;
        setState((s) => s && { ...s, messages: merge(s.messages, [result.message]) });
        setText("");
        setServer(null);
      } else {
        setError(errorText(result.error));
        if (result.error === "muted" || result.error === "off" || result.error === "noName") void poll();
      }
    } catch {
      setError(t.errors.failed);
    } finally {
      setSending(false);
      input.current?.focus();
    }
  }

  async function report(m: LobbyMessage, reason: ReportReason) {
    setMenu(null);
    try {
      const r = await reportLobbyMessage(m.id, reason);
      setNote({ id: m.id, text: r.ok ? t.reported : r.error === "tooMany" ? t.errors.reportTooMany : t.errors.failed });
    } catch {
      setNote({ id: m.id, text: t.errors.failed });
    }
  }

  async function moderate(m: LobbyMessage, action: ModAction, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setMenu(null);
    try {
      const r = await moderateLobby(action);
      if (!r.ok) return setNote({ id: m.id, text: t.mod.failed });
      if (action.kind === "delete") setState((s) => s && { ...s, messages: s.messages.filter((x) => x.id !== m.id) });
      else if (action.kind === "removeAll") setState((s) => s && { ...s, messages: s.messages.filter((x) => x.uid !== m.uid) });
      else setNote({ id: m.id, text: t.mod.done });
    } catch {
      setNote({ id: m.id, text: t.mod.failed });
    }
  }

  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => setNote(null), 3000);
    return () => clearTimeout(timer);
  }, [note]);

  if (!state) {
    return (
      <div className="help-guest">
        {failed ? (
          <>
            <p className="error small" role="alert">{t.failed}</p>
            <button type="button" className="secondary small" onClick={() => setAttempt((n) => n + 1)}>{t.retry}</button>
          </>
        ) : (
          <p className="muted small">{t.loading}</p>
        )}
      </div>
    );
  }

  const { me } = state;
  const shared = server ? state.servers?.find((s) => s.id === server) : null;

  return (
    <section className="card chat lobby">
      <div className="lobby-bar">
        <span className="muted small tabular">
          <span className="dot online" aria-hidden /> {format(t.online, { n: Math.max(state.online, 1) })}
        </span>
        {me.name && !me.muted && (
          <button
            type="button"
            className="lobby-icon lobby-me"
            title={t.changeName}
            onClick={() => setState((s) => s && { ...s, me: { ...s.me, name: null } })}
          >
            <span className="small">{format(t.yourName, { name: me.name })}</span>
          </button>
        )}
        <button type="button" className="lobby-icon" aria-expanded={rules} onClick={() => setRules((r) => !r)}>
          <Info size={16} aria-hidden /> <span className="small">{t.rulesButton}</span>
        </button>
      </div>
      {rules && (
        <div className="lobby-rules small" role="note">
          <p>{t.rules}</p>
          <Link href="/regulamin#czat-graczy">{t.rulesMore}</Link>
        </div>
      )}
      {!state.on && <p className={`notice ${admin ? "warn" : ""} lobby-off small`}>{admin ? t.offAdmin : t.off}</p>}
      {(state.on || admin) && (
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
              <span className="chat-empty-icon"><MessagesSquare size={28} aria-hidden /></span>
              <strong>{t.emptyTitle}</strong>
              <p className="muted small">{t.emptyHint}</p>
              {me.name && !me.muted && (
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
                const prev = messages[i - 1];
                const first = !prev || prev.author !== m.author || new Date(m.at).getTime() - new Date(prev.at).getTime() > 5 * 60_000;
                const open = menu?.id === m.id ? menu.kind : null;
                return (
                  <li key={m.id} className={`chat-msg lobby-msg${m.own ? " own" : ""}${m.admin ? " staff" : ""}${first ? " first" : ""}`}>
                    {first && (
                      <span className="chat-author">
                        {m.own ? t.you : m.author}
                        {m.admin && <span className="lobby-badge">{t.adminBadge}</span>}
                      </span>
                    )}
                    <div className="chat-row">
                      <div className="chat-bubble">
                        {m.body && <p>{m.body}</p>}
                        {m.server && (
                          <div className="lobby-server">
                            <span className="lobby-server-icon" aria-hidden><Server size={18} /></span>
                            <span className="lobby-server-text">
                              <strong className="break">{m.server.name}</strong>
                              <code className="break">{m.server.address}</code>
                            </span>
                            <CopyButton text={m.server.address} label={t.copyAddress} copiedLabel={t.copied} />
                          </div>
                        )}
                      </div>
                      {!m.own && !admin && (
                        <button
                          type="button"
                          className="lobby-act"
                          aria-label={t.report}
                          title={t.report}
                          aria-expanded={open === "report"}
                          onClick={() => setMenu(open ? null : { id: m.id, kind: "report" })}
                        >
                          <Flag size={15} aria-hidden />
                        </button>
                      )}
                      {admin && !m.own && (
                        <button
                          type="button"
                          className="lobby-act"
                          aria-label={t.more}
                          title={t.more}
                          aria-expanded={open === "mod"}
                          onClick={() => setMenu(open ? null : { id: m.id, kind: "mod" })}
                        >
                          <MoreHorizontal size={16} aria-hidden />
                        </button>
                      )}
                      {admin && m.own && (
                        <button type="button" className="lobby-act" aria-label={t.mod.delete} title={t.mod.delete} onClick={() => void moderate(m, { kind: "delete", messageId: m.id })}>
                          <Trash2 size={15} aria-hidden />
                        </button>
                      )}
                    </div>
                    {open === "report" && (
                      <div className="lobby-menu" role="group" aria-label={t.reportTitle}>
                        <span className="small muted">{t.reportTitle}</span>
                        {REASONS.map((r) => (
                          <button key={r} type="button" className="chip" onClick={() => void report(m, r)}>{t.reasons[r]}</button>
                        ))}
                        <button type="button" className="chip lobby-cancel" onClick={() => setMenu(null)}>{t.cancel}</button>
                      </div>
                    )}
                    {open === "mod" && m.uid && (
                      <div className="lobby-menu" role="group" aria-label={t.more}>
                        <button type="button" className="chip bad" onClick={() => void moderate(m, { kind: "delete", messageId: m.id })}>
                          <Trash2 size={14} aria-hidden /> {t.mod.delete}
                        </button>
                        <span className="small muted"><Ban size={13} aria-hidden /> {t.mod.mute}:</span>
                        {MUTE_HOURS.map((h) => (
                          <button key={h} type="button" className="chip" onClick={() => void moderate(m, { kind: "mute", userId: m.uid!, hours: h })}>
                            {t.mod.hours[String(h) as "1" | "24" | "168"]}
                          </button>
                        ))}
                        <button type="button" className="chip" onClick={() => void moderate(m, { kind: "mute", userId: m.uid!, hours: null })}>{t.mod.forever}</button>
                        <button type="button" className="chip" onClick={() => void moderate(m, { kind: "resetName", userId: m.uid! })}>{t.mod.resetName}</button>
                        <button type="button" className="chip bad" onClick={() => void moderate(m, { kind: "removeAll", userId: m.uid! }, t.mod.removeAllConfirm)}>{t.mod.removeAll}</button>
                      </div>
                    )}
                    {note?.id === m.id ? (
                      <span className="chat-time lobby-note" role="status">{note.text}</span>
                    ) : (
                      first || i === messages.length - 1 || messages[i + 1]?.author !== m.author ? <span className="chat-time">{m.time}</span> : null
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}

      {(state.on || admin) &&
        (!me.name ? (
          <NamePicker t={t} onPicked={(name) => setState((s) => s && { ...s, me: { ...s.me, name } })} errorText={errorText} />
        ) : me.muted ? (
          <p className="notice warn lobby-muted small">{me.muted === "forever" ? t.mutedForever : format(t.muted, { until: me.muted })}</p>
        ) : (
          <>
            {picking && (
              <div className="lobby-pick" role="group" aria-label={t.shareTitle}>
                <div className="lobby-pick-head">
                  <strong className="small">{t.shareTitle}</strong>
                  <button type="button" className="lobby-icon" aria-label={t.cancel} title={t.cancel} onClick={() => setPicking(false)}>
                    <X size={16} aria-hidden />
                  </button>
                </div>
                <p className="muted small">{t.shareHint}</p>
                {state.servers?.length ? (
                  <div className="lobby-pick-list">
                    {state.servers.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className="secondary lobby-pick-item"
                        onClick={() => {
                          setServer(s.id);
                          setPicking(false);
                          input.current?.focus();
                        }}
                      >
                        <strong className="break">{s.name}</strong>
                        <code className="break small">{s.address}</code>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="small">{t.noServers} <Link href="/dashboard/new">→</Link></p>
                )}
              </div>
            )}
            {shared && (
              <div className="chat-attachment">
                <span className="lobby-server-icon" aria-hidden><Server size={18} /></span>
                <span className="small break">
                  <strong>{shared.name}</strong> · <code>{shared.address}</code>
                </span>
                <button type="button" className="secondary chat-attachment-remove" onClick={() => setServer(null)} aria-label={t.removeServer} title={t.removeServer}>
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
            >
              <button
                type="button"
                className="secondary chat-attach"
                aria-label={t.shareServer}
                title={t.shareServer}
                aria-expanded={picking}
                onClick={() => setPicking((p) => !p)}
              >
                <Server size={18} aria-hidden />
              </button>
              <textarea
                ref={input}
                name="message"
                value={text}
                rows={1}
                maxLength={maxLength}
                placeholder={t.placeholder}
                aria-label={t.placeholder}
                aria-invalid={error ? true : undefined}
                onChange={(e) => {
                  setText(e.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <button type="submit" disabled={sending || (!text.trim() && !server)} aria-label={t.send}>
                <Send size={18} aria-hidden /> <span className="hide-phone">{sending ? t.sending : t.send}</span>
              </button>
            </form>
            <div className="chat-foot">
              {error ? <p className="error small" role="alert">{error}</p> : <span />}
              {text.length > maxLength - 100 && <span className="muted small tabular">{text.length}/{maxLength}</span>}
            </div>
          </>
        ))}
    </section>
  );
}

/** Asks for a nickname before the first message; reading needs none. */
function NamePicker({ t, onPicked, errorText }: { t: Messages["lobby"]; onPicked: (name: string) => void; errorText: (e: LobbyError) => string }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="lobby-name"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
          const r = await setChatNameAction(name);
          if (r.ok) onPicked(r.name);
          else setError(errorText(r.error));
        } catch {
          setError(t.errors.failed);
        } finally {
          setBusy(false);
        }
      }}
    >
      <strong>{t.pickTitle}</strong>
      <p className="muted small">{t.pickHint}</p>
      <div className="lobby-name-row">
        <input
          name="chatName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.pickPlaceholder}
          aria-label={t.pickTitle}
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          maxLength={16}
          minLength={3}
          required
        />
        <button type="submit" disabled={busy || name.trim().length < 3}>{t.pickButton}</button>
      </div>
      {error ? <p className="error small" role="alert">{error}</p> : <p className="muted small">{t.pickRules}</p>}
    </form>
  );
}
