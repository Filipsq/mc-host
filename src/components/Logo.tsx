import Link from "next/link";
import { BRAND } from "@/lib/brand";

export default function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="brand" aria-label={`${BRAND.first}${BRAND.rest}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/art/block-grass.svg" alt="" width={30} height={30} />
      <span>
        <span className="brand-accent">{BRAND.first}</span>
        {BRAND.rest}
      </span>
    </Link>
  );
}
