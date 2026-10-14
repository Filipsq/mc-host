"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export default function CopyButton({ text, label, copiedLabel }: { text: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="secondary small"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />} {copied ? copiedLabel : label}
    </button>
  );
}
