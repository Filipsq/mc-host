import Link from "next/link";
import { Ghost } from "lucide-react";
import { auth } from "@/auth";
import { getMessages } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { gameById } from "@/lib/games";
import { halloweenOn } from "@/lib/halloween";
import { planForRam } from "@/lib/modpacks";
import { resolveCurseforgePack, type CurseforgePack } from "@/lib/curseforge";
import { GameArt } from "./HomeArt";

// The Halloween ready games on the home page, inside the Halloween band: our own
// Halloween Survival (no mods, phones too) and a horror mod pack from CurseForge
// for those who want to be scared. Shown only while Halloween lasts.

/** The horror pack offered: psychological and classic horror on NeoForge 1.21.1. */
export const HORROR_PACK = "horrorland-2";

// Looked up at most once an hour (like the top list in curseforge.ts): it reads the pack's manifest.
const HOUR = 60 * 60 * 1000;
let horror: { at: number; pack: CurseforgePack | null } | null = null;

async function horrorPack() {
  if (!horror || Date.now() - horror.at > HOUR) {
    const found = await resolveCurseforgePack({ slug: HORROR_PACK });
    horror = { at: Date.now(), pack: typeof found === "object" ? found : null };
  }
  return horror.pack;
}

export default async function HalloweenGames() {
  if (!halloweenOn()) return null;
  const [t, session, pack] = await Promise.all([getMessages(), auth(), horrorPack()]);
  const h = t.home.halloweenGames;
  const link = (query: string) => (session?.user ? `/dashboard/new?${query}` : "/signup");
  const survival = gameById("halloween");

  return (
    <div className="hw-games stack">
      <h3 className="subsection-title"><Ghost size={20} aria-hidden /> {h.title}</h3>
      <p className="muted">{h.subtitle}</p>
      <ul className="hw-game-grid">
        <li className="feature game-card hw-game">
          <GameArt id="halloween" />
          <h3>{t.server.games.halloween}</h3>
          <p className="muted">{h.survivalText}</p>
          <ul className="plugin-chips">
            {h.survivalChips.map((c) => <li key={c}>{c}</li>)}
          </ul>
          <span className="ram-pill">{format(t.server.ramFrom, { gb: survival.ramGb })}</span>
          <Link className="button" href={link("game=halloween&kod=DYNIA20")}>{h.survivalCta}</Link>
        </li>
        {pack && (
          <li className="feature game-card hw-game">
            {/* Our own picture: a haunted house at night with a spider and a creeper (the pack's own is plain). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="hw-pack-art" src="/art/games/horror.svg" alt="" width={448} height={140} loading="lazy" />
            <h3>{pack.title.split(" - ")[0]}</h3>
            <p className="muted">{h.horrorText}</p>
            <ul className="plugin-chips">
              <li>{`${pack.loader} ${pack.gameVersion}`}</li>
              <li>{format(h.horrorMods, { count: pack.mods })}</li>
            </ul>
            <span className="ram-pill">{format(h.horrorPlan, { plan: t.plans[planForRam(pack.ramGb)] })}</span>
            <p className="muted small">{h.horrorNote}</p>
            <Link className="button secondary" href={link(`cf=${HORROR_PACK}&kod=DYNIA20`)}>{h.horrorCta}</Link>
          </li>
        )}
      </ul>
    </div>
  );
}
