"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";

type T = { title: string; steps: string[]; dontRestart: string; lastLine: string };

/*
 * What each step looks like in a Java server's log (itzg/minecraft-server image,
 * Paper/Fabric/Forge/NeoForge). The step a line matches is the step we are in;
 * we only ever move forward within one start.
 */
const STEP_LINES: RegExp[][] = [
  // 0: getting the server files, plugins and mods
  [/\[init\]/, /\[mc-image-helper\]/i, /download/i, /resolving/i, /installing/i],
  // 1: Java is up, the server itself starts
  [/Starting minecraft server/i, /Loading libraries/i, /Environment: /, /Starting Minecraft server on/i, /Loading properties/i],
  // 2: plugins and mods load
  [/Loading \d+ mods/i, /Loading plugins?/i, /\[[\w .-]+\] Loading [\w .-]+ v?\d/, /Loaded \d+ (mods|plugins)/i, /Initializing plugins/i],
  // 3: the world is prepared
  [/Preparing level/i, /Preparing (start region|spawn area)/i, /Loading terrain/i],
  // 4: ready
  [/Done \(\d/],
];
/** A new start of the container: progress from an earlier run in the log no longer counts. */
const NEW_RUN = /\[init\] (Running as uid|Changing uid|Changing gid)/;

function stepOf(line: string): number {
  for (let i = STEP_LINES.length - 1; i >= 0; i--) if (STEP_LINES[i].some((re) => re.test(line))) return i;
  return -1;
}

// Console colour codes and timestamps aren't for this little preview.
function clean(line: string) {
  return line.replace(/\x1b\[[0-9;]*m|\[[0-9;]*m/g, "").replace(/^\[\d{2}:\d{2}:\d{2}[^\]]*\]:?\s*/, "").trim();
}

/**
 * Shown on a Java server's overview while it starts: the steps of a start with
 * the current one lit and the newest log line, so a
 * slow first start (a big plugin set can take minutes) visibly moves instead of
 * looking stuck and being clicked again (which starts it over).
 */
export default function StartSteps({ id, t }: { id: string; t: T }) {
  const [step, setStep] = useState(0);
  const [last, setLast] = useState("");
  useEffect(() => {
    const source = new EventSource(`/api/servers/${id}/console`);
    source.onmessage = (e) => {
      let line: string;
      try {
        line = clean(String(JSON.parse(e.data)));
      } catch {
        return;
      }
      if (!line) return;
      if (NEW_RUN.test(line)) setStep(0);
      const s = stepOf(line);
      if (s > 0) setStep((cur) => Math.max(cur, s));
      setLast(line.length > 140 ? `${line.slice(0, 140)}…` : line);
    };
    return () => source.close();
  }, [id]);

  return (
    <div className="card start-steps" role="status" aria-live="polite">
      <b>{t.title}</b>
      <ol>
        {t.steps.map((label, i) => {
          // The last step ("ready") is done as soon as it is reached.
          const done = i < step || (i === step && i === t.steps.length - 1);
          return (
          <li key={label} className={done ? "done" : i === step ? "now" : undefined}>
            <span className="start-step-mark" aria-hidden>
              {done ? <Check size={14} /> : i === step ? <Loader2 size={14} className="spin" /> : null}
            </span>
            {label}
          </li>
          );
        })}
      </ol>
      {last && (
        <p className="start-steps-last">
          <span className="muted">{t.lastLine}</span> <code>{last}</code>
        </p>
      )}
      <p className="muted small">{t.dontRestart}</p>
    </div>
  );
}
