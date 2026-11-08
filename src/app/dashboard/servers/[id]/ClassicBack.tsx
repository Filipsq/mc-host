"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Props = { id: string; name: string; back: string };

/** The classic panel's way back: to the server list from the overview, to the overview from anywhere else. */
export default function ClassicBack({ id, name, back }: Props) {
  const pathname = usePathname();
  const base = `/dashboard/servers/${id}`;
  return pathname === base ? (
    <Link className="back" href="/dashboard">{back}</Link>
  ) : (
    <Link className="back" href={base}>← {name}</Link>
  );
}
