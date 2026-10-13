import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { getMessages, getPreferences } from "@/i18n/server";
import { planOptions } from "@/lib/planOptions";
import { getPackArt } from "@/lib/modrinth";
import { CURATED_PACKS, planForRam } from "@/lib/modpacks";
import CreateServerForm from "./CreateServerForm";

type Props = { searchParams: Promise<{ pack?: string }> };

export default async function NewServerPage({ searchParams }: Props) {
  const session = await getSession();
  if (!session?.user?.id) redirect("/login");
  const [t, { locale, currency }, freeCount, packArt, { pack }] = await Promise.all([
    getMessages(),
    getPreferences(),
    db.server.count({ where: { ownerId: session.user.id, plan: "FREE" } }),
    getPackArt(CURATED_PACKS.map((p) => p.slug)),
    searchParams,
  ]);
  const hasFree = freeCount > 0;
  const plans = planOptions(t, currency).map((p) =>
    p.id === "FREE" && hasFree ? { ...p, disabledNote: t.server.freeTaken } : p,
  );

  // Coming from a pack on the home page: that pack, on the smallest plan it runs on.
  const chosen = CURATED_PACKS.find((p) => p.slug === pack);
  const defaultPlan = chosen ? planForRam(chosen.ramGb) : hasFree ? "STARTER" : "FREE";
  const packIcons = Object.fromEntries(CURATED_PACKS.map((p) => [p.slug, packArt.get(p.slug)?.icon]));

  return (
    <main className="wide-form stack">
      <Link className="back" href="/dashboard">{t.server.back}</Link>
      <h1>{t.server.newTitle}</h1>
      <CreateServerForm
        t={t.server}
        billing={t.billing}
        legal={t.legal}
        plans={plans}
        defaultPlan={defaultPlan}
        initialPack={chosen?.slug}
        packIcons={packIcons}
        domain={process.env.GAME_DOMAIN ?? "localhost"}
        money={{ locale, currency }}
      />
    </main>
  );
}
