import Link from "next/link";
import { getMessages } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { planById } from "@/lib/plans";
import CreateServerForm from "./CreateServerForm";

export default async function NewServerPage() {
  const t = (await getMessages()).server;
  const free = planById("FREE");
  return (
    <main className="narrow">
      <p><Link href="/dashboard">{t.back}</Link></p>
      <h1>{t.newTitle}</h1>
      <CreateServerForm t={t} planInfo={format(t.planInfo, { gb: free.ramGb, n: free.maxPlayers ?? 0 })} />
    </main>
  );
}
