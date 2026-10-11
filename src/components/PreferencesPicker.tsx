"use client";

import { useEffect, useRef } from "react";
import { setPreferences } from "@/app/actions";
import {
  currencies,
  currencySymbols,
  localeNames,
  locales,
  type Currency,
  type Locale,
} from "@/i18n/config";

type Props = {
  locale: Locale;
  currency: Currency;
  labels: { language: string; currency: string };
};

export default function PreferencesPicker({ locale, currency, labels }: Props) {
  const ref = useRef<HTMLDetailsElement>(null);

  // Close the panel on an outside click, like a normal dropdown.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) ref.current.open = false;
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return (
    <details ref={ref} className="picker">
      <summary aria-label={`${labels.language} / ${labels.currency}`}>
        {locale.toUpperCase()} · {currencySymbols[currency]} {currency}
      </summary>
      <form
        action={setPreferences}
        className="picker-panel"
        onSubmit={() => {
          if (ref.current) ref.current.open = false;
        }}
      >
        <p className="picker-label">{labels.language}</p>
        <div className="picker-grid">
          {locales.map((l) => (
            <button key={l} name="locale" value={l} aria-pressed={l === locale} className="option">
              <strong>{l.toUpperCase()}</strong> {localeNames[l]}
            </button>
          ))}
        </div>
        <p className="picker-label">{labels.currency}</p>
        <div className="picker-grid">
          {currencies.map((c) => (
            <button key={c} name="currency" value={c} aria-pressed={c === currency} className="option">
              {currencySymbols[c]} {c}
            </button>
          ))}
        </div>
      </form>
    </details>
  );
}
