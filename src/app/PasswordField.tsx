"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import type { Messages } from "@/i18n/messages";
import { format } from "@/i18n/messages";

type Props = {
  label: string;
  t: Messages["auth"];
  /** Sign-up: a new password, with hints under the field. Log-in: the saved one. */
  isNew?: boolean;
  /** Changes on every submit that came back with an error, to shake the field. */
  errorTick?: number;
  /** The form is being sent: the creeper is pleased. */
  pending?: boolean;
};

// Passwords people pick first; flagged only after leaving the field ("punish late").
const COMMON = new Set([
  "12345678", "123456789", "1234567890", "11111111", "00000000", "87654321", "12341234", "qwertyui",
  "qwertyuiop", "password", "password1", "password123", "haslo123", "haslo1234", "minecraft", "minecraft1",
  "minecraft123", "zaq12wsx", "1qaz2wsx", "polska123", "iloveyou", "abcd1234", "qwerty123", "aaaaaaaa",
]);

type Hint = { text: string; tone: "muted" | "good" | "bad" };

function hintFor(value: string, touched: boolean, t: Messages["auth"]): Hint {
  const n = value.length;
  if (n === 0) return { text: t.pwHint, tone: "muted" };
  if (n < 8) {
    const left = 8 - n;
    const tpl = left === 1 ? t.pwMoreOne : left <= 4 ? t.pwMoreFew : t.pwMoreMany;
    return { text: format(tpl, { n: left }), tone: "muted" };
  }
  if (COMMON.has(value.toLowerCase())) return touched ? { text: t.pwCommon, tone: "bad" } : { text: t.pwGood, tone: "muted" };
  return isStrong(value) ? { text: t.pwStrong, tone: "good" } : { text: t.pwGood, tone: "muted" };
}

function isStrong(v: string) {
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(v)).length;
  return v.length >= 14 || (v.length >= 10 && kinds >= 3);
}

/**
 * A password field with a small pixel creeper peeking over its top edge. It watches the
 * caret while you type, and ducks behind the field when the password is shown, so it
 * never "sees" it. Pure decoration: hidden from screen readers.
 */
export default function PasswordField({ label, t, isNew, errorTick, pending }: Props) {
  const id = useId();
  const hintId = `${id}-hint`;
  const input = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState("");
  const [shown, setShown] = useState(false);
  const [focused, setFocused] = useState(false);
  const [touched, setTouched] = useState(false);
  const [look, setLook] = useState(0); // -1 = start of the field, 1 = its end

  // Where the caret is, as a share of what fits in the box, so the eyes follow typing.
  function follow() {
    const el = input.current;
    if (!el) return;
    const pos = el.selectionStart ?? el.value.length;
    const fits = Math.max(8, (el.clientWidth - 70) / 9);
    setLook(Math.min(pos / fits, 1) * 2 - 1);
  }

  // Wrong password or another server error: a short shake, then the field is ready again.
  useEffect(() => {
    const el = field.current;
    if (!errorTick || !el) return;
    el.classList.remove("pw-shake");
    void el.offsetWidth; // restart the animation on a second error in a row
    el.classList.add("pw-shake");
  }, [errorTick]);

  const strong = isNew && value.length >= 8 && isStrong(value) && !COMMON.has(value.toLowerCase());
  const pose = shown ? "hide" : focused || value ? "up" : "idle";
  const mood = pending || strong ? "happy" : "watch";
  const hint = isNew ? hintFor(value, touched, t) : null;

  return (
    <div className="pw-label">
      <label htmlFor={id}>{label}</label>
      <div className="pw-field" ref={field}>
        <span className={`creeper ${pose} ${mood}`} aria-hidden>
          <span className="creeper-clip">
            <svg className="creeper-head" viewBox="0 0 8 8" shapeRendering="crispEdges">
              <CreeperSkin />
              <g className="creeper-mouth" fill="#0d1a0a">
                <rect x="3" y="4" width="2" height="2" />
                <rect x="2" y="5" width="1" height="3" />
                <rect x="5" y="5" width="1" height="3" />
                <rect x="3" y="6" width="2" height="1" />
              </g>
              <g className="creeper-eyes" fill="#0d1a0a" style={{ transform: `translate(${(look * 0.5).toFixed(2)}px, ${pose === "up" ? 0.3 : 0}px)` }}>
                <rect className="eye-open" x="1" y="2" width="2" height="2" />
                <rect className="eye-open" x="5" y="2" width="2" height="2" />
                <path className="eye-happy" d="M1 3.4h.7v-.7h.6v-.7h.4v.7h.6v.7h.7v.6H1zM5 3.4h.7v-.7h.6v-.7h.4v.7h.6v.7h.7v.6H5z" />
              </g>
            </svg>
          </span>
          <span className="creeper-hand left" />
          <span className="creeper-hand right" />
        </span>
        <input
          ref={input}
          id={id}
          name="password"
          type={shown ? "text" : "password"}
          required
          minLength={8}
          autoComplete={isNew ? "new-password" : "current-password"}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby={hint ? hintId : undefined}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            follow();
          }}
          onSelect={follow}
          onKeyUp={follow}
          onFocus={() => {
            setFocused(true);
            follow();
          }}
          onBlur={() => {
            setFocused(false);
            if (value) setTouched(true);
          }}
        />
        <button
          type="button"
          className="pw-toggle"
          aria-label={shown ? t.hidePassword : t.showPassword}
          aria-pressed={shown}
          aria-controls={id}
          onClick={() => setShown((s) => !s)}
        >
          {shown ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
        </button>
      </div>
      {hint && (
        <p id={hintId} className={`pw-hint small ${hint.tone}`} aria-live="polite">
          {hint.text}
        </p>
      )}
    </div>
  );
}

// Mottled green 8×8 skin, drawn once (fixed pattern so it never flickers between renders).
const SHADES = ["#4f9a3a", "#5fb846", "#3e7f2d", "#6dc94f", "#56a83f"];
const PATTERN = "0132410224013402130420131402410320143012340241032014302103412042";
function CreeperSkin() {
  return (
    <g>
      {Array.from(PATTERN).map((c, i) => (
        <rect key={i} x={i % 8} y={Math.floor(i / 8)} width="1" height="1" fill={SHADES[Number(c)]} />
      ))}
    </g>
  );
}
