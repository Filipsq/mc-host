"use client";

import { useEffect, useRef, useState } from "react";
import { Clapperboard } from "lucide-react";
import { format } from "@/i18n/messages";
import type { Messages } from "@/i18n/messages";
import { AD_HOURS, AD_MEMORY_MB, AD_SLOTS, AD_WATCHES_PER_DAY } from "@/lib/adReward";
import { adRewardAction } from "../actions";

// Just what we use of Google Publisher Tag (gpt.js), the script behind Ad Manager's rewarded ads.
type Slot = { addService: (service: unknown) => Slot };
type GptEvent = { slot: Slot; isEmpty?: boolean; makeRewardedVisible?: () => void };
type Gpt = {
  cmd: { push: (fn: () => void) => void };
  defineOutOfPageSlot: (unit: string, format: unknown) => Slot | null;
  enums: { OutOfPageFormat: { REWARDED: unknown } };
  pubads: () => {
    addEventListener: (type: string, fn: (e: GptEvent) => void) => void;
    removeEventListener: (type: string, fn: (e: GptEvent) => void) => void;
  };
  enableServices: () => void;
  display: (slot: Slot) => void;
  destroySlots: (slots: Slot[]) => void;
};
declare global {
  interface Window {
    googletag?: Gpt;
  }
}

const GPT_SRC = "https://securepagead2.googlesyndication.com/tag/js/gpt.js";

function loadGpt(): Promise<Gpt> {
  window.googletag = window.googletag || ({ cmd: [] } as unknown as Gpt);
  if (document.querySelector(`script[src="${GPT_SRC}"]`)) return Promise.resolve(window.googletag);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = GPT_SRC;
    s.async = true;
    s.onload = () => resolve(window.googletag!);
    s.onerror = () => reject(new Error("blocked"));
    document.head.appendChild(s);
  });
}

type Phase = "idle" | "loading" | "playing" | "saving" | "granted" | "noAd" | "closed" | "blocked" | "limit" | "failed";

type Props = {
  id: string;
  unit: string;
  level: number; // rewards running now
  until: string | null; // when they end
  left: number; // ads still allowed in the last 24 hours
  nextAt: string | null; // when the next ad is allowed, once none are left
  running: boolean;
  locale: string;
  t: Messages["adReward"];
};

/** A free server's "watch an ad" button: a rewarded ad from Ad Manager, then more slots and RAM for a day. */
export default function AdReward({ id, unit, level, until, left: initialLeft, nextAt, running, locale, t }: Props) {
  const [phase, setPhase] = useState<Phase>(initialLeft > 0 ? "idle" : "limit");
  const [left, setLeft] = useState(initialLeft);
  const [endsAt, setEndsAt] = useState(until);
  const [lvl, setLvl] = useState(level);
  const cleanup = useRef<() => void>(undefined);

  useEffect(() => () => cleanup.current?.(), []);

  const time = (iso: string) =>
    new Intl.DateTimeFormat(locale, { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Warsaw" }).format(new Date(iso));

  async function watch() {
    setPhase("loading");
    let gpt: Gpt;
    try {
      gpt = await loadGpt();
    } catch {
      setPhase("blocked");
      return;
    }
    gpt.cmd.push(() => {
      const slot = gpt.defineOutOfPageSlot(unit, gpt.enums.OutOfPageFormat.REWARDED);
      if (!slot) {
        setPhase("noAd");
        return;
      }
      let granted = false;
      const pubads = gpt.pubads();
      const done = () => {
        pubads.removeEventListener("rewardedSlotReady", ready);
        pubads.removeEventListener("rewardedSlotGranted", grant);
        pubads.removeEventListener("rewardedSlotClosed", closed);
        pubads.removeEventListener("slotRenderEnded", rendered);
        gpt.destroySlots([slot]);
        cleanup.current = undefined;
      };
      const ready = (e: GptEvent) => {
        if (e.slot !== slot) return;
        setPhase("playing");
        e.makeRewardedVisible?.();
      };
      const grant = (e: GptEvent) => {
        if (e.slot === slot) granted = true;
      };
      const closed = async (e: GptEvent) => {
        if (e.slot !== slot) return;
        done();
        if (!granted) {
          setPhase("closed");
          return;
        }
        setPhase("saving");
        const res = await adRewardAction(id).catch(() => ({ error: "failed" as const }));
        if (res.error) {
          setPhase(res.error === "limit" ? "limit" : "failed");
          return;
        }
        setLeft(res.left ?? 0);
        setEndsAt(res.until ?? null);
        setLvl((l) => Math.min(l + 1, AD_WATCHES_PER_DAY));
        setPhase("granted");
      };
      const rendered = (e: GptEvent) => {
        if (e.slot !== slot || !e.isEmpty) return;
        done();
        setPhase("noAd");
      };
      pubads.addEventListener("rewardedSlotReady", ready);
      pubads.addEventListener("rewardedSlotGranted", grant);
      pubads.addEventListener("rewardedSlotClosed", closed);
      pubads.addEventListener("slotRenderEnded", rendered);
      cleanup.current = done;
      slot.addService(pubads);
      gpt.enableServices();
      gpt.display(slot);
    });
  }

  const vars = { slots: AD_SLOTS, mb: AD_MEMORY_MB, hours: AD_HOURS, n: AD_WATCHES_PER_DAY };
  const busy = phase === "loading" || phase === "playing" || phase === "saving";
  const message =
    phase === "granted"
      ? format(t.granted, vars)
      : phase === "noAd" || phase === "closed" || phase === "blocked" || phase === "failed"
        ? t[phase]
        : null;

  return (
    <div className="card stack-tight boost-card">
      <div className="row">
        <span className="stack-tight">
          <strong>
            <Clapperboard size={16} aria-hidden /> {t.title}
          </strong>
          <span className="muted small">{format(t.hint, vars)}</span>
          {lvl > 0 && endsAt && (
            <span className="small">{format(t.active, { slots: lvl * AD_SLOTS, mb: lvl * AD_MEMORY_MB, time: time(endsAt) })}</span>
          )}
        </span>
        {left > 0 && phase !== "limit" ? (
          <button type="button" onClick={watch} disabled={busy} aria-busy={busy}>
            {busy ? t.loading : format(t.watch, { n: left })}
          </button>
        ) : (
          <span className="muted small">{nextAt && phase !== "granted" ? format(t.limitUntil, { time: time(nextAt) }) : t.limit}</span>
        )}
      </div>
      {running && left > 0 && phase === "idle" && <span className="muted small">{t.restart}</span>}
      {message && <p className={phase === "granted" ? "notice success" : "notice warn"}>{message}</p>}
    </div>
  );
}
