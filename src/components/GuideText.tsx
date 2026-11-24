import Link from "next/link";
import { Fragment } from "react";

// Renders guide text from lib/guides.ts: [text](/path) becomes a link, and
// consecutive lines starting with "- " become one list.

export function Inline({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\))/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        return m ? <Link key={i} href={m[2]}>{m[1]}</Link> : <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}

export default function GuideText({ lines }: { lines: string[] }) {
  const blocks: (string | string[])[] = [];
  for (const line of lines) {
    if (line.startsWith("- ")) {
      const last = blocks[blocks.length - 1];
      if (Array.isArray(last)) last.push(line.slice(2));
      else blocks.push([line.slice(2)]);
    } else blocks.push(line);
  }
  return (
    <>
      {blocks.map((b, i) =>
        Array.isArray(b) ? (
          <ul key={i}>{b.map((item) => <li key={item}><Inline text={item} /></li>)}</ul>
        ) : (
          <p key={i}><Inline text={b} /></p>
        ),
      )}
    </>
  );
}

// Strips [text](/path) to text, for structured data.
export const plainText = (text: string) => text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
