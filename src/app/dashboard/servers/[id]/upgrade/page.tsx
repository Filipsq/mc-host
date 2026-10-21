import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { getOwnedServer } from "@/lib/servers";
import { formatPrice, plans } from "@/lib/plans";
import { canUpgrade, upgradeCost } from "@/lib/upgrade";
import UpgradeForm from "./UpgradeForm";

const DAY = 24 * 60 * 60 * 1000;

// A bigger plan for the rest of the paid period: pick a plan, see what changes
// and pay only the difference (src/lib/upgrade.ts).
export default async function UpgradePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const { id } = await params;
  const server = await getOwnedServer(id, session.user.id);
  if (!server) notFound();
  // Free, expired or unpaid servers buy a whole period on the billing page.
  if (!canUpgrade(server)) redirect(`/dashboard/servers/${server.id}/billing`);

  const [all, { locale, currency }] = await Promise.all([getMessages(), getPreferences()]);
  const t = all.upgrade;
  const now = new Date();
  const money = (n: number) => formatPrice(n, currency, locale);
  const current = plans.findIndex((p) => p.id === server.plan);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(server.paidUntil!);

  return (
    <main className="wide-form stack">
      <Link className="back" href={`/dashboard/servers/${server.id}`}>← {server.name}</Link>
      <h1>{t.title}</h1>
      <UpgradeForm
        serverId={server.id}
        current={server.plan}
        plans={plans
          .filter((p) => p.id !== "FREE")
          .map((p, i) => {
            const bigger = i + 1 > current;
            const cost = bigger ? upgradeCost(server.plan, p.id, server.paidUntil!, currency, now) : null;
            return {
              id: p.id,
              name: all.plans[p.id],
              ramGb: p.ramGb,
              diskGb: p.diskGb,
              cpus: p.cpus,
              maxPlayers: p.maxPlayers,
              backupsKept: p.backupsKept,
              specs: [
                format(all.plans.ram, { gb: p.ramGb }),
                format(all.plans.disk, { gb: p.diskGb }),
                p.maxPlayers === null ? all.plans.unlimitedPlayers : format(all.plans.players, { n: p.maxPlayers }),
              ].join(" · "),
              monthly: format(t.per30, { amount: money(p.price[currency]) }),
              bigger,
              cost: cost && { amount: money(cost.amount), atMinimum: cost.atMinimum },
            };
          })}
        costHint={format(t.costHint, { days: Math.max(1, Math.floor((server.paidUntil!.getTime() - now.getTime()) / DAY)), date })}
        moveNote={server.edition === "JAVA" && !server.crossplay ? t.moveNote : t.moveNoteBedrock}
        t={t}
        billing={all.billing}
        legal={all.legal}
        errors={all.server.errors}
      />
    </main>
  );
}
