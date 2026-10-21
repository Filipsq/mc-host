import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { getMessages, getPreferences } from "@/i18n/server";
import { planOptions } from "@/lib/planOptions";
import { getPackArt } from "@/lib/modrinth";
import { curseforgeEnabled, resolveCurseforgePack } from "@/lib/curseforge";
import { CURATED_PACKS, planForRam } from "@/lib/modpacks";
import { isGameId } from "@/lib/games";
import { DESCRIPTION_MAX, aiDailyLimit, aiEnabled } from "@/lib/ai";
import { isAdmin } from "@/lib/admin";
import CreateServerForm from "./CreateServerForm";

type Props = { searchParams: Promise<{ pack?: string; cf?: string; game?: string; opis?: string }> };

export default async function NewServerPage({ searchParams }: Props) {
  const session = await getSession();
  if (!session?.user?.id) {
    // A description from the home page's AI box survives signing in.
    const { opis } = await searchParams;
    redirect(opis ? `/login?opis=${encodeURIComponent(opis.slice(0, DESCRIPTION_MAX))}` : "/login");
  }
  const [t, { locale, currency }, freeCount, packArt, { pack, cf, game, opis }, admin] = await Promise.all([
    getMessages(),
    getPreferences(),
    // An admin's test servers don't use up their own free one.
    db.server.count({ where: { ownerId: session.user.id, plan: "FREE", adminTest: false } }),
    getPackArt(CURATED_PACKS.map((p) => p.slug)),
    searchParams,
    isAdmin(session.user.id),
  ]);
  const hasFree = freeCount > 0;
  const plans = planOptions(t, currency).map((p) =>
    p.id === "FREE" && hasFree ? { ...p, disabledNote: t.server.freeTaken } : p,
  );

  // Coming from a pack on the home page (or a game in the empty panel): that pack
  // or game, a pack on the smallest plan it runs on.
  const chosen = CURATED_PACKS.find((p) => p.slug === pack);
  const found = cf && curseforgeEnabled() ? await resolveCurseforgePack({ slug: cf }) : null;
  const cfPack = found && typeof found === "object" ? found : undefined;
  const initialGame = chosen || cfPack ? "modpack" : isGameId(game) ? game : undefined;
  const defaultPlan =
    initialGame === "modpack" ? planForRam(cfPack?.ramGb ?? (chosen ?? CURATED_PACKS[0]).ramGb) : hasFree ? "STARTER" : "FREE";
  const packIcons = Object.fromEntries(CURATED_PACKS.map((p) => [p.slug, packArt.get(p.slug)?.icon]));

  return (
    <main className="wide-form stack">
      <Link className="back" href="/dashboard">{t.server.back}</Link>
      <CreateServerForm
        title={t.server.newTitle}
        t={t.server}
        helper={t.helper}
        terraria={t.terraria}
        initialEdition={game === "terraria" ? "TERRARIA" : undefined}
        settings={t.settings}
        billing={t.billing}
        legal={t.legal}
        plans={plans}
        defaultPlan={defaultPlan}
        initialGame={initialGame}
        initialPack={cfPack ? "curseforge" : chosen?.slug}
        cfPack={
          cfPack && {
            slug: cfPack.slug,
            title: cfPack.title,
            summary: cfPack.summary,
            icon: cfPack.icon,
            ramGb: cfPack.ramGb,
            mods: cfPack.mods,
            gameVersion: cfPack.gameVersion,
            loader: cfPack.loader,
          }
        }
        curseforge={curseforgeEnabled()}
        packIcons={packIcons}
        domain={process.env.GAME_DOMAIN ?? "localhost"}
        money={{ locale, currency }}
        admin={admin}
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
