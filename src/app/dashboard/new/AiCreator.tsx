"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { format, type Messages } from "@/i18n/messages";
import { KNOWN_PLUGINS } from "@/lib/plugins";
import { CURATED_PACKS } from "@/lib/modpacks";
import type { Suggestion, SuggestError } from "@/lib/ai";
import { suggestServerAction } from "./aiActions";

type Props = {
  t: Messages["ai"];
  server: Messages["server"];
  settings: Messages["settings"];
  planNames: Record<string, string>;
  limits: { daily: number; length: number };
  /** A description brought from the home page, asked about straight away. */
  initialPrompt?: string;
  onSuggestion: (s: Suggestion) => void;
  /** Keep the filled-in form but drop the AI's game settings and extra plugins. */
  onDiscardSettings: () => void;
};

/** "Describe your server": asks the AI and hands its pick to the create form, which fills itself in. */
export default function AiCreator({ t, server, settings, planNames, limits, initialPrompt, onSuggestion, onDiscardSettings }: Props) {
  const [text, setText] = useState(initialPrompt ?? "");
  const [result, setResult] = useState<Suggestion | null>(null);
  const [discarded, setDiscarded] = useState(false);
  const [error, setError] = useState<SuggestError | null>(null);
  const [pending, start] = useTransition();
  const asked = useRef(false);

  function ask(description: string) {
    if (!description.trim()) {
      setError("empty");
      return;
    }
    setError(null);
    start(async () => {
      const res = await suggestServerAction(description).catch(() => ({ ok: false as const, error: "failed" as const }));
      if (res.ok) {
        setResult(res.suggestion);
        setDiscarded(false);
        onSuggestion(res.suggestion);
      } else {
        setError(res.error);
      }
    });
  }

  // Coming from the home page: ask once, and drop the description from the address so a reload doesn't ask again.
  useEffect(() => {
    if (!initialPrompt || asked.current) return;
    asked.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete("opis");
    window.history.replaceState(null, "", url);
    ask(initialPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, [initialPrompt]);

  const game = result && (result.pack ? CURATED_PACKS.find((p) => p.slug === result.pack)?.title : server.games[result.game]);

  return (
    <section className="card stack ai-card" aria-busy={pending}>
      <header className="stack-tight">
        <h2 className="ai-title">
          <Sparkles size={20} aria-hidden /> {t.formTitle}
        </h2>
        <p className="muted small">{t.formHint}</p>
      </header>
      <textarea
        className="ai-input"
        value={text}
        rows={3}
        maxLength={limits.length}
        placeholder={t.placeholder}
        aria-label={t.formTitle}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            ask(text);
          }
        }}
      />
      {!result && !text && (
        <div className="chat-suggestions ai-examples">
          {t.examples.map((ex) => (
            <button key={ex} type="button" className="chip" onClick={() => setText(ex)}>
              {ex}
            </button>
          ))}
        </div>
      )}
      <div className="row">
        <p className="muted small ai-privacy">{t.privacy}</p>
        <button type="button" className="ai-button" disabled={pending} onClick={() => ask(text)}>
          <Sparkles size={18} aria-hidden /> {pending ? t.thinking : t.submit}
        </button>
      </div>
      {error && (
        <p className="error small" role="alert">
          {format(t.errors[error], { n: error === "tooLong" ? limits.length : limits.daily })}
        </p>
      )}
      {result && !pending && (
        <div className="ai-result stack" role="status">
          <p className="ai-result-title">{t.resultTitle}</p>
          <p>{result.summary}</p>
          <ul className="ai-picks">
            <li className="chip">{result.edition === "JAVA" ? "Java" : "Bedrock"}</li>
            <li className="chip">{game}</li>
            <li className="chip">{planNames[result.plan]}</li>
            {!discarded && (
              <>
                <li className="chip">{settings.modes[result.gameMode]}</li>
                <li className="chip">{settings.difficulties[result.difficulty]}</li>
                {result.edition === "JAVA" && <li className="chip">{result.pvp ? t.pvpOn : t.pvpOff}</li>}
                {result.plugins.map((p) => (
                  <li key={p} className="chip">+ {KNOWN_PLUGINS[p].title}</li>
                ))}
              </>
            )}
          </ul>
          {!discarded && result.motd && (
            <p className="small">
              <span className="muted">{t.motd}:</span> {result.motd}
            </p>
          )}
          <p className="muted small">{discarded ? t.discarded : t.applied}</p>
          {!discarded && (
            <button
              type="button"
              className="secondary small ai-discard"
              onClick={() => {
                setDiscarded(true);
                onDiscardSettings();
              }}
            >
              {t.discard}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
