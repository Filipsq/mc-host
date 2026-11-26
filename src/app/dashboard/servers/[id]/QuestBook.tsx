"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Check, ChevronDown, X } from "lucide-react";
import type { Quest, QuestKey } from "@/lib/quests";
import { doQuestAction, hideQuestsAction } from "./questActions";

type Props = {
  id: string;
  quests: Quest[];
  done: string[];
  hidden: boolean;
  running: boolean;
  t: { title: string; progress: string; next: string; all: string; allDone: string; allDoneNote: string; hide: string; show: string; less: string };
};

/**
 * Księga questów: the first steps on the panel's right, like a game's quest log.
 * A quest is a link to its tab, and opening the tab does it. On a phone it folds
 * to the next quest only.
 */
export default function QuestBook({ id, quests, done: savedDone, hidden: savedHidden, running, t }: Props) {
  const pathname = usePathname();
  const base = `/dashboard/servers/${id}`;
  const [done, setDone] = useState<Set<string>>(() => new Set(["create", ...savedDone]));
  const [hidden, setHidden] = useState(savedHidden);
  const [open, setOpen] = useState(false);
  // The quest that just got its tick, to make it pop once.
  const [fresh, setFresh] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const finish = (key: QuestKey) => {
    if (done.has(key)) return;
    setDone((d) => new Set(d).add(key));
    setFresh(key);
    startTransition(() => doQuestAction(id, key));
  };

  // Opening a quest's tab does it; the server running does "start".
  useEffect(() => {
    const here = quests.find((q) => q.path && (pathname === base + q.path || pathname.startsWith(base + q.path + "/")));
    if (here) finish(here.key);
    if (running && quests.some((q) => q.key === "start")) finish("start");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, running]);

  const count = quests.filter((q) => done.has(q.key)).length;
  const next = quests.find((q) => !done.has(q.key));
  const progress = t.progress.replace("{n}", String(count)).replace("{all}", String(quests.length));

  const setHide = (value: boolean) => {
    setHidden(value);
    startTransition(() => hideQuestsAction(id, value));
  };

  if (hidden) {
    return (
      <button type="button" className="quest-reopen" onClick={() => setHide(false)}>
        <BookOpen size={16} aria-hidden /> {t.show} <span className="quest-count">{progress}</span>
      </button>
    );
  }

  const href = (q: Quest) => (q.path === null ? base : base + q.path);

  return (
    <section className={open ? "card quest-book open" : "card quest-book"} aria-label={t.title}>
      <div className="quest-head">
        <BookOpen size={18} aria-hidden className="quest-icon" />
        <strong>{t.title}</strong>
        <span className="quest-count">{progress}</span>
        <button type="button" className="quest-close" onClick={() => setHide(true)} aria-label={t.hide} title={t.hide}>
          <X size={16} aria-hidden />
        </button>
      </div>
      <div className="quest-bar" aria-hidden>
        <span style={{ width: `${(count / quests.length) * 100}%` }} />
      </div>

      {next ? (
        <Link className="quest-next" href={href(next)}>
          <span className="quest-next-label">{t.next}</span>
          <span>{next.label}</span>
        </Link>
      ) : (
        <div className="quest-done-all">
          <strong>{t.allDone}</strong>
          <span>{t.allDoneNote}</span>
          <button type="button" className="secondary small" onClick={() => setHide(true)}>
            {t.hide}
          </button>
        </div>
      )}

      <ol className="quest-list">
        {quests.map((q) => {
          const isDone = done.has(q.key);
          const body = (
            <>
              <span className={q.key === fresh ? "quest-box pop" : "quest-box"} aria-hidden>
                {isDone && <Check size={13} strokeWidth={3} />}
              </span>
              <span className="quest-label">{q.label}</span>
            </>
          );
          return (
            <li key={q.key} className={isDone ? "done" : undefined}>
              {q.path === null || (q.key === "start" && isDone) ? (
                <span className="quest-item">{body}</span>
              ) : (
                <Link className="quest-item" href={href(q)}>
                  {body}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
      <button type="button" className="quest-more" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? t.less : t.all} <ChevronDown size={14} aria-hidden />
      </button>
    </section>
  );
}
