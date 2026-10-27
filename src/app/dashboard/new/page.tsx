import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { getMessages, getPreferences } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { addonOptions, planOptions } from "@/lib/planOptions";
import { getPackArt } from "@/lib/modrinth";
import { curseforgeEnabled, curseforgePackOptions, resolveCurseforgePack } from "@/lib/curseforge";
import { curseforgePackValue } from "./ModFields";
import { CURATED_PACKS, planForRam } from "@/lib/modpacks";
import { isGameId } from "@/lib/games";
import { DESCRIPTION_MAX, aiDailyLimit, aiEnabled } from "@/lib/ai";
import { isAdmin } from "@/lib/admin";
import { CREATOR_DISCOUNT, FREE_STARTER_DAYS, suggestedCreatorCode } from "@/lib/creator";
import { usableGift } from "@/lib/gifts";
import { HALLOWEEN_CODE, HALLOWEEN_DISCOUNT, halloweenOn } from "@/lib/halloween";
import CreateServerForm from "./CreateServerForm";

type Props = { searchParams: Promise<{ pack?: string; cf?: string; game?: string; opis?: string; prezent?: string; kod?: string }> };

export default async function NewServerPage({ searchParams }: Props) {
  const session = await getSession();
  if (!session?.user?.id) {
    // A description from the home page's AI box survives signing in.
    const { opis } = await searchParams;
    redirect(opis ? `/login?opis=${encodeURIComponent(opis.slice(0, DESCRIPTION_MAX))}` : "/login");
  }
  const [t, { locale, currency }, freeCount, packArt, { pack, cf, game, opis, prezent, kod }, admin, code, { freeStarters }] = await Promise.all([
    getMessages(),
    getPreferences(),
    // An admin's test servers don't use up their own free one.
    db.server.count({ where: { ownerId: session.user.id, plan: "FREE", adminTest: false } }),
    getPackArt(CURATED_PACKS.map((p) => p.slug)),
    searchParams,
    isAdmin(session.user.id),
    suggestedCreatorCode(session.user.id),
    db.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { freeStarters: true } }),
  ]);
  const hasFree = freeCount > 0;
  // Came from "Załóż nowy serwer z prezentem": the gift's plan, paid with its code.
  const giftFound = prezent ? await usableGift(prezent) : null;
  const gift = giftFound && "gift" in giftFound ? giftFound.gift : null;
  const plans = planOptions(t, currency).map((p) =>
    p.id === "FREE" && hasFree ? { ...p, disabledNote: t.server.freeTaken } : p,
  );

  // Coming from a pack on the home page (or a game in the empty panel): that pack
  // or game, a pack on the smallest plan it runs on.
  const chosen = CURATED_PACKS.find((p) => p.slug === pack);
  const found = cf && curseforgeEnabled() ? await resolveCurseforgePack({ slug: cf }) : null;
  const cfPack = found && typeof found === "object" ? found : undefined;
  const cfPacks = curseforgeEnabled() ? await curseforgePackOptions(cfPack) : [];
  const initialGame = chosen || cfPack ? "modpack" : isGameId(game) ? game : undefined;
  const defaultPlan = gift
    ? gift.plan
    : initialGame === "modpack"
      ? planForRam(cfPack?.ramGb ?? (chosen ?? CURATED_PACKS[0]).ramGb)
      : hasFree || freeStarters > 0
        ? "STARTER"
        : "FREE";
  const packIcons = Object.fromEntries(CURATED_PACKS.map((p) => [p.slug, packArt.get(p.slug)?.icon]));

  return (
    <main className="wide-form stack">
      <Link className="back" href="/dashboard">{t.server.back}</Link>
      <CreateServerForm
        title={t.server.newTitle}
        t={t.server}
        helper={t.helper}
        paidAddons={t.paidAddons}
        addonOptions={addonOptions(t, currency)}
        terraria={t.terraria}
        initialEdition={game === "terraria" ? "TERRARIA" : undefined}
        settings={t.settings}
        billing={t.billing}
        legal={t.legal}
        plans={plans}
        defaultPlan={defaultPlan}
        initialGame={initialGame}
        halloween={halloweenOn()}
        initialPack={cfPack ? curseforgePackValue(cfPack.slug) : chosen?.slug}
        cfPacks={cfPacks}
        cfPicked={!!cfPack}
        curseforge={curseforgeEnabled()}
        packIcons={packIcons}
        domain={process.env.GAME_DOMAIN ?? "localhost"}
        money={{ locale, currency }}
        admin={admin}
        creator={{
          t: t.creator,
          // A code from a link (the Halloween band on the home page) before the inviter's.
          code: kod?.trim().slice(0, 20) || code,
          freeStarters,
          discount: CREATOR_DISCOUNT,
          days: FREE_STARTER_DAYS,
          promo: halloweenOn() ? { code: HALLOWEEN_CODE, discount: HALLOWEEN_DISCOUNT, hint: t.halloween.codeApplied, label: t.halloween.codeField } : undefined,
        }}
        gift={
          gift
            ? {
                code: gift.code,
                plan: gift.plan,
                label: format(t.gifts.useGift, { plan: t.plans[gift.plan], days: gift.days }),
                hint: format(t.gifts.useGiftHint, { code: gift.code }),
              }
            : undefined
        }
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
