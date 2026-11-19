"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";

/** How long after a form is sent an error or "saved" message still counts as its answer. */
const ANSWER_WINDOW = 20_000;
/** Tooltips: wait this long on the first hover, but show at once when moving between buttons. */
const TIP_DELAY = 600;
const TIP_SKIP = 300;

const FIELD = "input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=submit]):not([hidden]), textarea, select";

/**
 * Site-wide feel, without touching any form's logic:
 * - a form error shakes the field it is about and puts the cursor there,
 * - a "saved" message also pops up as a small toast at the bottom,
 * - buttons and links with a title get a quick, neat tooltip instead of the browser's slow grey one.
 */
export default function UiFeel() {
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let lastSubmit: { form: HTMLFormElement; at: number } | null = null;
    const lastField = new WeakMap<HTMLFormElement, HTMLElement>();

    const shake = (el: HTMLElement) => {
      const box = (el.closest("label") as HTMLElement | null) ?? el;
      box.classList.remove("ui-shake");
      void box.offsetWidth; // restart the animation if it is already there
      box.classList.add("ui-shake");
      box.addEventListener("animationend", () => box.classList.remove("ui-shake"), { once: true });
    };
    const markInvalid = (el: HTMLElement) => {
      el.setAttribute("aria-invalid", "true");
      el.addEventListener("input", () => el.removeAttribute("aria-invalid"), { once: true });
    };

    // Which form did the user just send, and which field did they last type in.
    const onSubmit = (e: Event) => {
      if (e.target instanceof HTMLFormElement) lastSubmit = { form: e.target, at: Date.now() };
    };
    const onInput = (e: Event) => {
      const el = e.target as HTMLElement;
      const form = el.closest?.("form");
      if (form && el.matches(FIELD)) lastField.set(form, el);
    };
    // The browser's own check (empty required field, too short): shake that field too.
    const onInvalid = (e: Event) => {
      const el = e.target as HTMLElement;
      if (!el.matches?.(FIELD)) return;
      shake(el);
    };

    const fresh = (el: Element) => {
      if (!lastSubmit || Date.now() - lastSubmit.at > ANSWER_WINDOW) return null;
      const form = el.closest("form") ?? (lastSubmit.form.isConnected ? lastSubmit.form : null);
      if (!form) return null;
      // The message must belong to the form that was sent (inside it or right after it).
      if (form !== lastSubmit.form && !el.closest("form")) return null;
      return form as HTMLFormElement;
    };

    const onError = (el: HTMLElement) => {
      const form = fresh(el);
      if (!form) return;
      const named = el.dataset.field ? form.querySelector<HTMLElement>(`[name="${CSS.escape(el.dataset.field)}"]`) : null;
      const typed = lastField.get(form);
      const field = named ?? (typed?.isConnected ? typed : null) ?? form.querySelector<HTMLElement>(FIELD);
      if (!field || (field as HTMLInputElement).disabled) return;
      shake(field);
      markInvalid(field);
      field.focus({ preventScroll: true });
      if (field instanceof HTMLInputElement && field.type !== "file" && field.type !== "number") field.select?.();
      field.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
    };

    const onSaved = (el: HTMLElement) => {
      if (!fresh(el) && !(lastSubmit && Date.now() - lastSubmit.at < ANSWER_WINDOW)) return;
      const text = (el.textContent ?? "").trim();
      if (!text) return;
      // The toast says the first sentence; the note stays on the page only if it says more than that.
      const first = text.match(/^.+?[.!](\s|$)/)?.[0].trim() ?? text;
      const short = first.length > 60 ? first.slice(0, 57).trimEnd() + "…" : first;
      if (first === text && text.length <= 60) el.classList.add("ui-toasted");
      clearTimeout(toastTimer.current);
      setToast({ id: Date.now(), text: short });
      toastTimer.current = setTimeout(() => setToast(null), 3200);
      lastSubmit = null; // one toast per send
    };

    const look = (node: Node) => {
      if (!(node instanceof HTMLElement)) return;
      const errors = node.matches("p.error, .error[role=alert]") ? [node] : Array.from(node.querySelectorAll<HTMLElement>("p.error, .error[role=alert]"));
      errors.forEach(onError);
      const saved = node.matches(".notice.success") ? [node] : Array.from(node.querySelectorAll<HTMLElement>(".notice.success"));
      saved.forEach(onSaved);
    };
    const observer = new MutationObserver((list) => {
      for (const m of list) m.addedNodes.forEach(look);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Tooltips (mouse only; on touch screens the label is enough).
    const hover = matchMedia("(hover: hover) and (pointer: fine)");
    const tip = document.createElement("div");
    tip.className = "ui-tip";
    tip.setAttribute("role", "tooltip");
    tip.hidden = true;
    document.body.append(tip);
    let tipFor: HTMLElement | null = null;
    let tipTimer: ReturnType<typeof setTimeout> | undefined;
    let hiddenAt = 0;

    const place = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      tip.hidden = false;
      const w = tip.offsetWidth;
      const h = tip.offsetHeight;
      const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
      const above = r.top - h - 8 >= 8;
      tip.style.left = `${left}px`;
      tip.style.top = `${above ? r.top - h - 8 : r.bottom + 8}px`;
      tip.dataset.side = above ? "top" : "bottom";
    };
    const show = (el: HTMLElement) => {
      tip.textContent = el.dataset.tip ?? "";
      tip.classList.toggle("instant", Date.now() - hiddenAt < TIP_SKIP);
      place(el);
    };
    const hide = () => {
      clearTimeout(tipTimer);
      if (!tip.hidden) hiddenAt = Date.now();
      tip.hidden = true;
      tipFor = null;
    };
    const takeTitle = (el: HTMLElement) => {
      const title = el.getAttribute("title");
      if (title) {
        // Our tooltip replaces the browser's; keep the name for screen readers.
        el.dataset.tip = title;
        el.removeAttribute("title");
        if (!el.getAttribute("aria-label") && !(el.textContent ?? "").trim()) el.setAttribute("aria-label", title);
      }
      return el.dataset.tip;
    };
    const target = (e: Event) =>
      (e.target as Element | null)?.closest?.<HTMLElement>("button[title], a[title], summary[title], [role=button][title], button[data-tip], a[data-tip], summary[data-tip], [role=button][data-tip]") ?? null;
    const onOver = (e: PointerEvent) => {
      if (!hover.matches || e.pointerType !== "mouse") return;
      const el = target(e);
      if (el === tipFor) return;
      hide();
      if (!el || !takeTitle(el)) return;
      tipFor = el;
      const wait = Date.now() - hiddenAt < TIP_SKIP ? 0 : TIP_DELAY;
      tipTimer = setTimeout(() => tipFor === el && el.isConnected && show(el), wait);
    };
    const onFocus = (e: FocusEvent) => {
      const el = target(e);
      if (!el || !el.matches(":focus-visible") || !takeTitle(el)) return;
      hide();
      tipFor = el;
      show(el);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide();

    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("input", onInput, true);
    document.addEventListener("invalid", onInvalid, true);
    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", hide);
    document.addEventListener("keydown", onKey);
    addEventListener("scroll", hide, { passive: true, capture: true });
    return () => {
      observer.disconnect();
      tip.remove();
      clearTimeout(tipTimer);
      document.removeEventListener("submit", onSubmit, true);
      document.removeEventListener("input", onInput, true);
      document.removeEventListener("invalid", onInvalid, true);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("keydown", onKey);
      removeEventListener("scroll", hide, { capture: true });
    };
  }, []);

  return (
    <div className="ui-toast-area" aria-live="polite">
      {toast && (
        <div key={toast.id} className="ui-toast" role="status">
          <span className="ui-toast-check" aria-hidden><Check size={16} strokeWidth={3} /></span>
          {toast.text}
        </div>
      )}
    </div>
  );
}
