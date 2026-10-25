"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { sendCommandAction } from "../actions";
import type { Messages } from "@/i18n/messages";
import { PLAYER_COMMANDS, WORLD_COMMANDS, cleanNick, type ConsoleGame } from "./quickCommands";
import { hintFor, isErrorLine, type HintId } from "./consoleHints";

const MAX_LINES = 500;
// Colour codes some plugins print (often without the escape character), which a browser shows as "[0;39m".
const ANSI = /\u001b?\[[0-9;]*m/g;
const plain = (line: string) => line.replace(ANSI, "");

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
      setLines((prev) => [...prev, plain(JSON.parse(e.data) as string)].slice(-MAX_LINES));
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
    if (res.output) setLines((prev) => [...prev, `> ${line}`, plain(res.output!)].slice(-MAX_LINES));
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
  // Known problems in the log, newest first, each explained once above the console.
  const hints = useMemo(() => {
    const found: HintId[] = [];
    for (let i = lines.length - 1; i >= 0; i--) {
      const h = hintFor(lines[i]);
      if (h && !found.includes(h)) found.push(h);
    }
    return found;
  }, [lines]);

  return (
    <section className="stack">
      <h2>{t.console}</h2>
      {hints.length > 0 && (
        <div className="stack console-hints" role="status">
          <strong>{t.hints.title}</strong>
          {hints.map((h) => (
            <p key={h} className="notice warn">
              <strong>{t.hints.list[h].title}</strong>
              <br />
              {t.hints.list[h].fix}
            </p>
          ))}
        </div>
      )}
      <div className="console-layout">
        <div className="stack console-main">
          <div className="console-frame">
            <div className="console-bar" aria-hidden>
              <i /><i /><i /><span>latest.log</span>
            </div>
            <div className="console-body">
              <pre ref={logRef} className="console" aria-live="polite">
                {lines.length
                  ? lines.map((line, i) => (
                      <span key={i} className={hintFor(line) ? "console-hint" : isErrorLine(line) ? "console-error" : undefined}>
                        {line}
                        {"\n"}
                      </span>
                    ))
                  : t.consoleEmpty}
              </pre>
            </div>
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
