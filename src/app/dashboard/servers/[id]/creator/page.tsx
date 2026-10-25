import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getOwnedServer } from "@/lib/servers";
import { getMessages } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { CREATOR_DISCOUNT, CREATOR_GOAL, FREE_STARTER_DAYS } from "@/lib/creator";
import ReferralProgram, { type ProgramSearch } from "../../../invite/ReferralProgram";

// The owner's creator code and invites, in the server panel's menu too. They
// belong to the account, so this is the same as /dashboard/invite.
export default async function CreatorPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<ProgramSearch> }) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const [{ id }, search, all] = await Promise.all([params, searchParams, getMessages()]);
  const server = await getOwnedServer(id, session.user.id);
  if (!server) notFound();

  return (
    <div className="stack">
      <header>
        <h2>{all.creator.title}</h2>
        <p className="muted">{format(all.creator.subtitle, { percent: CREATOR_DISCOUNT, goal: CREATOR_GOAL, days: FREE_STARTER_DAYS })}</p>
      </header>
      <ReferralProgram userId={session.user.id} search={search} back={`/dashboard/servers/${server.id}/creator`} />
    </div>
  );
}
