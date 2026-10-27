import Link from "next/link";
import { Ghost } from "lucide-react";
import { auth } from "@/auth";
import { getMessages } from "@/i18n/server";
import { format } from "@/i18n/messages";
import { gameById } from "@/lib/games";
import { halloweenOn } from "@/lib/halloween";
import { LOADER_NAMES, planForRam } from "@/lib/modpacks";
import { curseforgeEnabled, resolveCurseforgePack } from "@/lib/curseforge";
import { resolveModpack } from "@/lib/modrinth";
import { GameArt } from "./HomeArt";

// The Halloween ready games on the home page, inside the Halloween band: our own
// Halloween Survival (no mods, phones too) and a horror mod pack for those who
// want to be scared. Shown only while Halloween lasts.

// Horror packs offered, the first one that a server can run: from CurseForge
// (DREAD, the most played horror pack, Forge 1.19.2, picked by Fiq; Horrorland 2,
// NeoForge 1.21.1, has mods only CurseForge may hand out), else from Modrinth,
// whose packs never hold mods that can't be downloaded.
const HORROR_CURSEFORGE = ["dread-arrenek", "horrorland-2"];
const HORROR_MODRINTH = ["gots-scary-pack", "spooky-scary"];
// Modrinth doesn't say how much memory a pack needs; these run on Standard.
const MODRINTH_RAM_GB = 6;

type HorrorPack = { title: string; loader: string; gameVersion: string; mods?: number; ramGb: number; query: string };

// Looked up at most once an hour (like the top list in curseforge.ts): it reads the pack's manifest.
// When neither site answered, asked again after a few minutes.
const HOUR = 60 * 60 * 1000;
const RETRY = 5 * 60 * 1000;
let horror: { at: number; ttl: number; pack: HorrorPack | null } | null = null;

async function findHorrorPack(): Promise<{ pack: HorrorPack | null; unavailable: boolean }> {
  let unavailable = false;
  for (const slug of HORROR_CURSEFORGE) {
    const p = await resolveCurseforgePack({ slug });
    if (typeof p === "object") {
      return { pack: { title: p.title, loader: p.loader, gameVersion: p.gameVersion, mods: p.mods, ramGb: p.ramGb, query: `cf=${p.slug}` }, unavailable };
    }
    if (curseforgeEnabled()) console.warn(`halloween horror pack: curseforge ${slug}: ${p}`);
    unavailable ||= p === "curseforgeUnavailable";
  }
  for (const slug of HORROR_MODRINTH) {
    const p = await resolveModpack({ slug });
    if (typeof p === "object") {
      return { pack: { title: p.title, loader: p.loader, gameVersion: p.gameVersion, ramGb: MODRINTH_RAM_GB, query: `mr=${p.slug}` }, unavailable };
    }
    console.warn(`halloween horror pack: modrinth ${slug}: ${p}`);
    unavailable ||= p === "modrinthUnavailable";
  }
  return { pack: null, unavailable };
}

async function horrorPack() {
  if (!horror || Date.now() - horror.at > horror.ttl) {
    const { pack, unavailable } = await findHorrorPack();
    horror = { at: Date.now(), ttl: !pack && unavailable ? RETRY : HOUR, pack };
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
              <li>{`${LOADER_NAMES[pack.loader] ?? pack.loader} ${pack.gameVersion}`}</li>
              {pack.mods !== undefined && <li>{format(h.horrorMods, { count: pack.mods })}</li>}
            </ul>
            <span className="ram-pill">{format(h.horrorPlan, { plan: t.plans[planForRam(pack.ramGb)] })}</span>
            <p className="muted small">{h.horrorNote}</p>
            <Link className="button secondary" href={link(`${pack.query}&kod=DYNIA20`)}>{h.horrorCta}</Link>
          </li>
        )}
      </ul>
    </div>
  );
}
