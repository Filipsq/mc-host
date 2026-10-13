import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { getMessages, getPreferences } from "@/i18n/server";
import { planOptions } from "@/lib/planOptions";
import { getPackArt } from "@/lib/modrinth";
import { CURATED_PACKS, planForRam } from "@/lib/modpacks";
import { isGameId } from "@/lib/games";
import { DESCRIPTION_MAX, aiDailyLimit, aiEnabled } from "@/lib/ai";
import CreateServerForm from "./CreateServerForm";

type Props = { searchParams: Promise<{ pack?: string; game?: string; opis?: string }> };

export default async function NewServerPage({ searchParams }: Props) {
  const session = await getSession();
  if (!session?.user?.id) {
    // A description from the home page's AI box survives signing in.
    const { opis } = await searchParams;
    redirect(opis ? `/login?opis=${encodeURIComponent(opis.slice(0, DESCRIPTION_MAX))}` : "/login");
  }
  const [t, { locale, currency }, freeCount, packArt, { pack, game, opis }] = await Promise.all([
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

  // Coming from a pack on the home page (or a game in the empty panel): that pack
  // or game, a pack on the smallest plan it runs on.
  const chosen = CURATED_PACKS.find((p) => p.slug === pack);
  const initialGame = chosen ? "modpack" : isGameId(game) ? game : undefined;
  const defaultPlan =
    initialGame === "modpack" ? planForRam((chosen ?? CURATED_PACKS[0]).ramGb) : hasFree ? "STARTER" : "FREE";
  const packIcons = Object.fromEntries(CURATED_PACKS.map((p) => [p.slug, packArt.get(p.slug)?.icon]));

  return (
    <main className="wide-form stack">
      <Link className="back" href="/dashboard">{t.server.back}</Link>
      <h1>{t.server.newTitle}</h1>
      <CreateServerForm
        t={t.server}
        settings={t.settings}
        billing={t.billing}
        legal={t.legal}
        plans={plans}
        defaultPlan={defaultPlan}
        initialGame={initialGame}
        initialPack={chosen?.slug}
        packIcons={packIcons}
        domain={process.env.GAME_DOMAIN ?? "localhost"}
        money={{ locale, currency }}
        ai={
          aiEnabled()
            ? {
                t: t.ai,
                settings: t.settings,
                limits: { daily: aiDailyLimit(), length: DESCRIPTION_MAX },
                initialPrompt: opis?.trim().slice(0, DESCRIPTION_MAX) || undefined,
              }
            : undefined
        }
      />
    </main>
  );
}
