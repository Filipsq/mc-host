"use client";

import { useEffect, useRef, useState } from "react";
import { sendCommandAction } from "../actions";
import type { Messages } from "@/i18n/messages";
import { PLAYER_COMMANDS, WORLD_COMMANDS, cleanNick, type ConsoleGame } from "./quickCommands";

const MAX_LINES = 500;

export default function Console({ id, game, t }: { id: string; game: ConsoleGame; t: Messages["server"] }) {
  const [lines, setLines] = useState<string[]>([]);
  const [command, setCommand] = useState("");
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const [nick, setNick] = useState("");
  const [message, setMessage] = useState("");
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const source = new EventSource(`/api/servers/${id}/console`);
    source.onmessage = (e) => {
      setLines((prev) => [...prev, JSON.parse(e.data) as string].slice(-MAX_LINES));
    };
    // Each reconnect replays the last 200 lines, so start fresh instead of duplicating them.
    source.onopen = () => setLines([]);
    return () => source.close();
  }, [id]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  // Sends one line to the server and shows its answer; true when it went through.
  async function run(line: string) {
    setSending(true);
    setError(undefined);
    const res = await sendCommandAction(id, line);
    setSending(false);
    if (res.error) {
      setError(t.errors[res.error]);
      return false;
    }
    if (res.output) setLines((prev) => [...prev, `> ${line}`, res.output!].slice(-MAX_LINES));
    return true;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!command.trim()) return;
    if (await run(command)) setCommand("");
  }

  async function say(e: React.FormEvent) {
    e.preventDefault();
    const text = message.replace(/[\r\n]/g, " ").trim();
    if (!text) return;
    if (await run(`say ${text}`)) setMessage("");
  }

  const q = t.quick;
  const player = cleanNick(nick);

  return (
    <section className="stack">
      <h2>{t.console}</h2>
      <div className="console-layout">
        <div className="stack">
          <div className="console-frame">
            <div className="console-bar" aria-hidden>
              <i /><i /><i /><span>latest.log</span>
            </div>
            <pre ref={logRef} className="console" aria-live="polite">
              {lines.length ? lines.join("\n") : t.consoleEmpty}
            </pre>
          </div>
          <form onSubmit={submit} className="row command">
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder={t.commandPlaceholder}
              aria-label={t.commandPlaceholder}
              maxLength={500}
            />
            <button type="submit" disabled={sending}>{t.send}</button>
          </form>
          {error && <p className="error">{error}</p>}
        </div>

        <aside className="card quick-commands" aria-label={q.title}>
          <h3>{q.title}</h3>
          <div className="quick-group">
            <span className="quick-label">{q.player}</span>
            <input
              value={nick}
              onChange={(e) => setNick(e.target.value)}
              placeholder={q.nick}
              aria-label={q.nick}
              maxLength={32}
              autoComplete="off"
              spellCheck={false}
            />
            {!player && <p className="muted small">{q.nickHint}</p>}
            <div className="quick-buttons">
              {PLAYER_COMMANDS[game].map((c) => (
                <button
                  key={c.label}
                  type="button"
                  className="secondary small"
                  disabled={sending || !player}
                  title={player ? c.command(player) : undefined}
                  onClick={() => run(c.command(player))}
                >
                  {q[c.label]}
                </button>
              ))}
            </div>
          </div>
          <div className="quick-group">
            <span className="quick-label">{q.world}</span>
            <div className="quick-buttons">
              {WORLD_COMMANDS[game].map((c) => (
                <button
                  key={c.label}
                  type="button"
                  className="secondary small"
                  disabled={sending}
                  title={c.command("")}
                  onClick={() => run(c.command(""))}
                >
                  {q[c.label]}
                </button>
              ))}
            </div>
          </div>
          <form onSubmit={say} className="quick-group">
            <span className="quick-label">{q.message}</span>
            <div className="row command">
              <input value={message} onChange={(e) => setMessage(e.target.value)} aria-label={q.message} maxLength={200} />
              <button type="submit" className="small" disabled={sending || !message.trim()}>{q.say}</button>
            </div>
          </form>
        </aside>
      </div>
    </section>
  );
}
