import Link from "next/link";

// Puts a link where a translated sentence says {link}, e.g. "I accept the {link}".
export default function LinkedText({ text, href, label, newTab }: { text: string; href: string; label: string; newTab?: boolean }) {
  const [before, after = ""] = text.split("{link}");
  return (
    <>
      {before}
      <Link href={href} {...(newTab && { target: "_blank" })}>
        {label}
      </Link>
      {after}
    </>
  );
}
