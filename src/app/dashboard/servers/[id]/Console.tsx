"use client";

import { useEffect, useRef, useState } from "react";
import { sendCommandAction } from "../actions";
import type { Messages } from "@/i18n/messages";

const MAX_LINES = 500;

export default function Console({ id, t }: { id: string; t: Messages["server"] }) {
  const [lines, setLines] = useState<string[]>([]);
  const [command, setCommand] = useState("");
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!command.trim()) return;
    setSending(true);
    setError(undefined);
    const res = await sendCommandAction(id, command);
    setSending(false);
    if (res.error) {
      setError(t.errors[res.error]);
      return;
    }
    if (res.output) setLines((prev) => [...prev, `> ${command}`, res.output!].slice(-MAX_LINES));
    setCommand("");
  }

  return (
    <section className="stack">
      <h2>{t.console}</h2>
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
    </section>
  );
}
