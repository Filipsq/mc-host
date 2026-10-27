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
// Halloween Survival (no mods, phones too) and horror mod packs for those who
// want to be scared. Shown only while Halloween lasts.

// Two horror tiles, each showing the first pack a server can run. CurseForge's
// DREAD (Forge 1.19.2, picked by Fiq) and Horrorland 2 (NeoForge 1.21.1) both
// have mods only CurseForge may hand out (live, 27.10), so each falls back to
// a Modrinth horror pack, which never holds such mods.
const HORROR_TILES = [
  { key: "dread", curseforge: ["dread-arrenek"], modrinth: ["spooky-scary"] },
  { key: "horror", curseforge: ["horrorland-2"], modrinth: ["gots-scary-pack", "spooky-scary"] },
] as const;
// Modrinth doesn't say how much memory a pack needs; these run on Standard.
const MODRINTH_RAM_GB = 6;

type HorrorPack = { title: string; loader: string; gameVersion: string; mods?: number; ramGb: number; query: string };
type Candidates = { curseforge: readonly string[]; modrinth: readonly string[] };

// Looked up at most once an hour (like the top list in curseforge.ts): it reads the pack's manifest.
// When no site answered, asked again after a few minutes.
const HOUR = 60 * 60 * 1000;
const RETRY = 5 * 60 * 1000;
const found = new Map<string, { at: number; ttl: number; pack: HorrorPack | null }>();

async function findHorrorPack({ curseforge, modrinth }: Candidates): Promise<{ pack: HorrorPack | null; unavailable: boolean }> {
  let unavailable = false;
  for (const slug of curseforge) {
    const p = await resolveCurseforgePack({ slug });
    if (typeof p === "object") {
      return { pack: { title: p.title, loader: p.loader, gameVersion: p.gameVersion, mods: p.mods, ramGb: p.ramGb, query: `cf=${p.slug}` }, unavailable };
    }
    if (curseforgeEnabled()) console.warn(`halloween horror pack: curseforge ${slug}: ${p}`);
    unavailable ||= p === "curseforgeUnavailable";
  }
  for (const slug of modrinth) {
    const p = await resolveModpack({ slug });
    if (typeof p === "object") {
      return { pack: { title: p.title, loader: p.loader, gameVersion: p.gameVersion, ramGb: MODRINTH_RAM_GB, query: `mr=${p.slug}` }, unavailable };
    }
    console.warn(`halloween horror pack: modrinth ${slug}: ${p}`);
    unavailable ||= p === "modrinthUnavailable";
  }
  return { pack: null, unavailable };
}

async function horrorPack(key: string, candidates: Candidates) {
  const cached = found.get(key);
  if (cached && Date.now() - cached.at <= cached.ttl) return cached.pack;
  const { pack, unavailable } = await findHorrorPack(candidates);
  found.set(key, { at: Date.now(), ttl: !pack && unavailable ? RETRY : HOUR, pack });
  return pack;
}

export default async function HalloweenGames() {
  if (!halloweenOn()) return null;
  const [t, session, ...horror] = await Promise.all([getMessages(), auth(), ...HORROR_TILES.map((c) => horrorPack(c.key, c))]);
  // The same pack twice (both lists ending on it) shows once.
  const packs = horror
    .map((pack, i) => pack && { pack, key: HORROR_TILES[i].key })
    .filter((x, i, all): x is { pack: HorrorPack; key: (typeof HORROR_TILES)[number]["key"] } => !!x && all.findIndex((y) => y?.pack.query === x.pack.query) === i);
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
        {packs.map(({ pack, key }) => (
          <li key={key} className="feature game-card hw-game">
            {/* Our own picture: a haunted house at night with a spider and a creeper (the packs' own are plain). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={`hw-pack-art hw-pack-art-${key}`} src="/art/games/horror.svg" alt="" width={448} height={140} loading="lazy" />
            <h3>{pack.title.split(" - ")[0]}</h3>
            <p className="muted">{pack.query === "cf=dread-arrenek" ? h.dreadText : h.horrorText}</p>
            <ul className="plugin-chips">
              <li>{`${LOADER_NAMES[pack.loader] ?? pack.loader} ${pack.gameVersion}`}</li>
              {pack.mods !== undefined && <li>{format(h.horrorMods, { count: pack.mods })}</li>}
            </ul>
            <span className="ram-pill">{format(h.horrorPlan, { plan: t.plans[planForRam(pack.ramGb)] })}</span>
            <p className="muted small">{h.horrorNote}</p>
            <Link className="button secondary" href={link(`${pack.query}&kod=DYNIA20`)}>{h.horrorCta}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
