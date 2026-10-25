import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getMessages } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { CREATOR_DISCOUNT, CREATOR_GOAL, FREE_STARTER_DAYS } from "@/lib/creator";
import ReferralProgram, { type ProgramSearch } from "./ReferralProgram";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getMessages()).creator.title };
}

export default async function InvitePage({ searchParams }: { searchParams: Promise<ProgramSearch> }) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const [all, search] = await Promise.all([getMessages(), searchParams]);

  return (
    <main className="stack">
      <Link className="back" href="/dashboard">← {all.dashboard.title}</Link>
      <header>
        <h1>{all.creator.title}</h1>
        <p className="muted">{format(all.creator.subtitle, { percent: CREATOR_DISCOUNT, goal: CREATOR_GOAL, days: FREE_STARTER_DAYS })}</p>
      </header>
      <ReferralProgram userId={session.user.id} search={search} back="/dashboard/invite" />
    </main>
  );
}
